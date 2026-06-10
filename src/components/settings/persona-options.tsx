"use client";

/**
 * Opzioni condivise persona (pagina Profilo + wizard /setup):
 * icone preset (lucide) e card tono con frase di anteprima reale.
 */
import {
  BedDouble,
  Dumbbell,
  Home,
  Scale,
  ShoppingCart,
  Sparkles,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Tone } from "@/lib/settings/schema";

export const PRESET_ICONS: Record<string, LucideIcon> = {
  UtensilsCrossed,
  ShoppingCart,
  Scale,
  Sparkles,
  Home,
  Wrench,
  BedDouble,
  Dumbbell,
};

export const FALLBACK_PRESET_ICON: LucideIcon = Sparkles;

export interface ToneOption {
  value: Tone;
  label: string;
  description: string;
  preview: string;
}

export const TONE_OPTIONS: ToneOption[] = [
  {
    value: "professionale",
    label: "Professionale",
    description: "Cortese e diretto",
    preview: "Buongiorno! Certo, posso aiutarti subito con la tua richiesta.",
  },
  {
    value: "amichevole",
    label: "Amichevole",
    description: "Caloroso e informale",
    preview: "Ciao! 😊 Certo, ti aiuto volentieri: dimmi pure!",
  },
  {
    value: "entusiasta",
    label: "Entusiasta",
    description: "Energico e motivante",
    preview: "Ciao! Che bello sentirti 💪 Ti racconto subito tutto!",
  },
  {
    value: "formale",
    label: "Formale (Lei)",
    description: "Sobrio e istituzionale",
    preview: "Buongiorno. La ringrazio per averci contattato: resto a disposizione.",
  },
];
