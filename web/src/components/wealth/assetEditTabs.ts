export type AssetEditTab = 'info' | 'tracking'

export function isAssetEditTab(tab: string): tab is AssetEditTab {
  return tab === 'info' || tab === 'tracking'
}
