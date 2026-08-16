#!/usr/bin/env bash
# Utente IAM dedicato per openwa-web — DA ESEGUIRE A MANO, NON automatizzare.
#
# Perché: fino a oggi openwa-web usa la chiave di `bedrock-invoker`, CONDIVISA da
# 8 applicazioni. È la chiave che è stata compromessa il 13/08/2026 (attacco
# respinto, danno zero). Con una chiave per app, un leak futuro costringe a
# ruotare un solo punto e CloudTrail dice subito da dove è partito.
#
# Verificato dal codice (16/08/2026), non ipotizzato:
#   - unico consumer AWS: src/lib/ai/bedrock.ts (BedrockRuntimeClient)
#   - comandi usati: ConverseCommand + InvokeModel → una sola azione IAM:
#     bedrock:InvokeModel (NON esiste un'azione bedrock:Converse)
#   - nessuno streaming (0 occorrenze di ConverseStream/InvokeModelWithResponseStream)
#   - nessun control plane, niente Polly/Transcribe/S3/STS
#   - modelli: solo i due inference profile EU in src/lib/settings/presets.ts
#   - embed() su titan-embed-text-v2 NON ha chiamanti (codice morto): la Sid
#     corrispondente è volutamente ESCLUSA dalla policy. Aggiungerla se/quando
#     il RAG verrà cablato.
#
# ATTENZIONE sui profili `eu.*`: sono inference profile CROSS-REGION. Una policy
# che elenchi solo l'ARN di eu-central-1 produce AccessDenied INTERMITTENTE
# quando la richiesta viene instradata su un'altra region EU. Per questo la
# policy autorizza i foundation model in tutte le region EU, ma vincolati dalla
# condizione bedrock:InferenceProfileArn.
set -euo pipefail

ACCOUNT=575582492628
USER_NAME=bedrock-openwa
POLICY_FILE="$(dirname "$0")/bedrock-openwa-policy.json"

echo "== 0. conferma account =="
aws sts get-caller-identity
read -rp "L'account è $ACCOUNT? [invio per continuare, Ctrl-C per uscire] " _

echo "== 1. utente dedicato (nessun accesso console) =="
aws iam create-user --user-name "$USER_NAME" \
  --tags Key=app,Value=openwa-web Key=owner,Value=bruno Key=created,Value=2026-08-16

echo "== 2. policy INLINE (non riutilizzabile per sbaglio da altre app) =="
aws iam put-user-policy --user-name "$USER_NAME" \
  --policy-name bedrock-openwa-invoke \
  --policy-document "file://$POLICY_FILE"

echo "== 3. verifica A SECCO prima di creare la chiave =="
echo "-- atteso: allowed"
aws iam simulate-principal-policy \
  --policy-source-arn "arn:aws:iam::$ACCOUNT:user/$USER_NAME" \
  --action-names bedrock:InvokeModel \
  --resource-arns "arn:aws:bedrock:eu-central-1:$ACCOUNT:inference-profile/eu.anthropic.claude-sonnet-4-5-20250929-v1:0" \
  --query 'EvaluationResults[0].EvalDecision' --output text

echo "-- atteso: implicitDeny (fuori EU)"
aws iam simulate-principal-policy \
  --policy-source-arn "arn:aws:iam::$ACCOUNT:user/$USER_NAME" \
  --action-names bedrock:InvokeModel \
  --resource-arns "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0" \
  --query 'EvaluationResults[0].EvalDecision' --output text

echo "== 4. access key =="
echo "L'output contiene il SEGRETO: non incollarlo in chat né in un file di log."
echo "Va copiato direttamente nelle Environment Variables di Coolify (app openwa-web)."
read -rp "Creare la access key ora? [y/N] " ans
[[ "$ans" == "y" ]] || { echo "saltato."; exit 0; }
aws iam create-access-key --user-name "$USER_NAME"

cat <<'NOTE'

== CUTOVER (senza downtime) ==
Le due chiavi restano valide contemporaneamente: non esiste finestra di invalidità.
1. Coolify → app openwa-web (ewkgwc4sggw04o4888w0sw4k) → Environment Variables:
     BEDROCK_ACCESS_KEY_ID     ← nuovo AKIA... di bedrock-openwa
     BEDROCK_SECRET_ACCESS_KEY ← nuovo segreto
     BEDROCK_REGION            ← INVARIATO (eu-central-1)
   Modificare dalla UI/API di Coolify, NON editando il .env a mano: Coolify lo
   rigenera al deploy e la modifica manuale andrebbe persa.
   Nessuna variabile nuova, nessuna da rimuovere, NESSUNA modifica al codice.
2. Redeploy di openwa-web in orario di basso traffico.
   Il gateway openwa-gw NON va toccato: non ha credenziali AWS, ed è l'app che
   custodisce la sessione WhatsApp. Verificato: openwa-web non monta alcun volume,
   quindi un suo redeploy NON tocca il pairing WhatsApp (nessun QR da riscansionare).
   Unico effetto: per i secondi del riavvio i webhook in arrivo possono fallire —
   il gateway ha retry configurato (retryCount 3).
3. Verifiche:
   - docker exec <container web> printenv BEDROCK_ACCESS_KEY_ID → nuovo prefisso
   - Playground con un preset Haiku e uno Sonnet: entrambi devono rispondere
   - docker logs --since 10m → nessun AccessDeniedException / UnrecognizedClientException
   - messaggio WhatsApp reale → la risposta AI viene generata (esercita reply.ts)
   - CloudTrail: eventName=InvokeModel → userIdentity.userName = bedrock-openwa
4. Rollback: rimettere i due valori precedenti in Coolify e redeploy.
   Tenere la vecchia chiave attiva 24-48h prima di eliminarla.
5. NB: qui non c'è nulla da revocare — openwa non ha una chiave propria su
   bedrock-invoker, la chiave è CONDIVISA. Va programmata la migrazione delle
   altre 7 app, ciascuna col proprio utente, e solo alla fine la rotazione finale
   di bedrock-invoker.
NOTE
