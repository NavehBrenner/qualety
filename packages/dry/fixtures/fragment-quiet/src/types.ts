export interface CopyA {
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

export interface CopyB {
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

export type AliasA = { quantity: number; unitPrice: number; taxRate: number };
export type AliasB = { quantity: number; unitPrice: number; taxRate: number };
