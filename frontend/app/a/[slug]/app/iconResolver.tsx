import {
  Users, ShoppingCart, Package, FileText, LayoutDashboard,
  BookOpen, Code, Tag, Globe, Heart, List, CheckCircle, Utensils, Menu,
  Calendar, Stethoscope, Activity, CreditCard, Receipt, Warehouse,
  Truck, Building2, Briefcase, GraduationCap, Car, MapPin, ClipboardList,
  DollarSign, UserCog, PawPrint, Home, ChefHat,
} from 'lucide-react';

// Estratto da DynamicLayoutRenderer.tsx: riusato sia dalla dashboard
// autenticata sia dalla landing pubblica (LandingPublic in page.tsx).
const ICON_MAP: Record<string, React.ReactNode> = {
  users: <Users size={18} />,
  orders: <ShoppingCart size={18} />,
  products: <Package size={18} />,
  invoices: <FileText size={18} />,
  dashboard: <LayoutDashboard size={18} />,
  default: <LayoutDashboard size={18} />,
  docs: <BookOpen size={18} />,
  api: <Code size={18} />,
  method: <Tag size={18} />,
  endpoint: <Globe size={18} />,
  product: <Package size={18} />,
  cart: <ShoppingCart size={18} />,
  recipe: <Heart size={18} />,
  ingredient: <List size={18} />,
  step: <CheckCircle size={18} />,
  restaurant: <Utensils size={18} />,
  menu: <Menu size={18} />,
  dish: <Utensils size={18} />,
};

// Mappa per nome tabella (in italiano, come generate dal Creator AI): icone
// semanticamente corrette per ambito, invece della LayoutDashboard generica
// che si otterrebbe risolvendo per `table.icon` (spesso un'emoji, es. "👥",
// che non trova mai corrispondenza in ICON_MAP e ricade sempre sul default).
const NAME_ICON_MAP: Record<string, React.ReactNode> = {
  pazienti: <Users size={18} />,
  clienti: <Users size={18} />,
  utenti: <Users size={18} />,
  studenti: <GraduationCap size={18} />,
  dipendenti: <UserCog size={18} />,
  appuntamenti: <Calendar size={18} />,
  prenotazioni: <Calendar size={18} />,
  eventi: <Calendar size={18} />,
  corsi: <GraduationCap size={18} />,
  interventi: <Stethoscope size={18} />,
  visite: <Stethoscope size={18} />,
  terapie: <Activity size={18} />,
  trattamenti: <Activity size={18} />,
  pagamenti: <CreditCard size={18} />,
  fatture: <Receipt size={18} />,
  fatturazione: <Receipt size={18} />,
  ordini: <ShoppingCart size={18} />,
  prodotti: <Package size={18} />,
  articoli: <Package size={18} />,
  magazzino: <Warehouse size={18} />,
  inventario: <Warehouse size={18} />,
  fornitori: <Truck size={18} />,
  spedizioni: <Truck size={18} />,
  consegne: <Truck size={18} />,
  aziende: <Building2 size={18} />,
  dati_aziendali: <Building2 size={18} />,
  impostazioni_azienda: <Building2 size={18} />,
  progetti: <Briefcase size={18} />,
  pratiche: <ClipboardList size={18} />,
  contratti: <FileText size={18} />,
  immobili: <Home size={18} />,
  proprieta: <Home size={18} />,
  veicoli: <Car size={18} />,
  animali: <PawPrint size={18} />,
  pazienti_veterinari: <PawPrint size={18} />,
  sedi: <MapPin size={18} />,
  ricette: <ChefHat size={18} />,
  piatti: <Utensils size={18} />,
  tavoli: <Utensils size={18} />,
  spese: <DollarSign size={18} />,
  entrate: <DollarSign size={18} />,
};

export function resolveIcon(icon: string, name?: string) {
  if (name) {
    const byName = NAME_ICON_MAP[name.toLowerCase().trim()];
    if (byName) return byName;
  }
  return ICON_MAP[icon?.toLowerCase() || 'default'] || ICON_MAP.default;
}
