export interface TableDraftColumn {
  key: string
  label: string
  align?: 'left' | 'center' | 'right'
}

export type TableDraftCellValue = string | number | null

export interface TableDraftRow {
  id: string
  cells: Record<string, TableDraftCellValue>
}

export interface PendingTableDraft {
  status: 'draft_ready'
  title: string
  description?: string
  columns: TableDraftColumn[]
  rows: TableDraftRow[]
  editable: boolean
  canConfirm: boolean
  chartPending: boolean
  sessionToken: string
  chartPrompt?: string
  xKey?: string
  yKey?: string
}

export interface ChartResult {
  status: 'chart_ready'
  imageUrl: string
  downloadUrl?: string
  mimeType?: string
  width?: number
  height?: number
  summary?: string
}
