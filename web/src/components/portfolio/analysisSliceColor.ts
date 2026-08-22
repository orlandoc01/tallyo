const analysisColors = ['#0f766e', '#2563eb', '#7c3aed', '#ea580c', '#0891b2', '#65a30d', '#db2777', '#475569', '#b45309', '#dc2626', '#4f46e5', '#64748b']

export function analysisSliceColor(label: string, index: number) {
  return label === 'Unclassified' ? '#94a3b8' : analysisColors[index % analysisColors.length]
}
