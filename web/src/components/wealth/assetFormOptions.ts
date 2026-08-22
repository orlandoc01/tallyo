import type { AssetClassifier, AssetType } from '../../types/graphql'

export const CLASSIFIER_OPTIONS: Record<AssetType, AssetClassifier[]> = {
  CURRENCY: ['CASH'],
  SECURITY: ['PUBLIC', 'COMPANY_EQUITY'],
  CRYPTO: ['CRYPTOCURRENCY', 'STABLECOIN'],
  REAL_ESTATE: ['REAL_ESTATE'],
  OTHER: ['CASH', 'PUBLIC', 'COMPANY_EQUITY', 'CRYPTOCURRENCY', 'STABLECOIN', 'REAL_ESTATE'],
}

export const CLASSIFIER_LABELS: Record<AssetClassifier, string> = {
  CASH: 'Cash & Equivalents',
  PUBLIC: 'Public Assets',
  COMPANY_EQUITY: 'Company Equity',
  CRYPTOCURRENCY: 'Cryptocurrency',
  STABLECOIN: 'Stablecoin',
  REAL_ESTATE: 'Real Estate',
}

export function defaultClassifierForAssetType(assetType: AssetType) {
  return CLASSIFIER_OPTIONS[assetType][0]
}
