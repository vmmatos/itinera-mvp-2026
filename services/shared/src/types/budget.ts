export type BudgetCategory = 'accommodation' | 'restaurants' | 'activities' | 'transport' | 'buffer';

export interface BudgetCategoryDetail {
  amountPerPerson: number;
  amountTotal: number;
  /** true when a real price could not be sourced and this is a heuristic estimate */
  isEstimate: boolean;
  /** e.g. 'serpapi_google_hotels' | 'google_places_price_level' | 'attraction_db' | 'heuristic_estimate' */
  source: string;
}

export interface BudgetOverrun {
  category: BudgetCategory;
  overAmountPerPerson: number;
  overAmountTotal: number;
}

export interface SuggestedCut {
  category: Exclude<BudgetCategory, 'buffer'>;
  description: string;
  savingPerPerson: number;
  savingTotal: number;
}

export interface BudgetBreakdown {
  currency: string;
  /** true when trip.budgetCurrency !== 'EUR' — figures below are still computed in EUR */
  currencyMismatch: boolean;
  groupSize: number;
  categories: Record<BudgetCategory, BudgetCategoryDetail>;
  perPersonTotal: number;
  grandTotal: number;
  budgetTotal: number;
  status: 'within_budget' | 'over_budget';
  percentageUsed: number;
  overruns: BudgetOverrun[];
  suggestedCuts: SuggestedCut[];
}
