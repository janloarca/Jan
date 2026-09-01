'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { DynamicDataSheetGrid, textColumn, keyColumn } from 'react-datasheet-grid'
import 'react-datasheet-grid/dist/style.css'
import { evaluateFormula, COL_LETTERS } from '@/lib/spreadsheet/formulaEngine'
import { FORMULA_CATALOG } from '@/lib/spreadsheet/formulas'

const NUM_COLS = 10
const DEFAULT_ROWS = 30

function createEmptyRows(count) {
  return Array.from({ length: count }, () => {
    const row = {}
    for (let i = 0; i < NUM_COLS; i++) row[COL_LETTERS[i]] = ''
    return row
  })
}

export default function SpreadsheetGrid({ initialRows, context, onSave, lang }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [data, setData] = useState(() => {
    if (initialRows && initialRows.length > 0) {
      const rows = initialRows.map(r => {
        const row = {}
        for (let i = 0; i < NUM_COLS; i++) row[COL_LETTERS[i]] = r[COL_LETTERS[i]] || ''
        return row
      })
      while (rows.length < DEFAULT_ROWS) {
        const row = {}
        for (let i = 0; i < NUM_COLS; i++) row[COL_LETTERS[i]] = ''
        rows.push(row)
      }
      return rows
    }
    return createEmptyRows(DEFAULT_ROWS)
  })

  const [activeCell, setActiveCell] = useState(null)
  const [showFormulas, setShowFormulas] = useState(false)
  const saveTimerRef = useRef(null)

  const evaluated = useMemo(() => {
    return data.map(row => {
      const result = {}
      for (const [col, val] of Object.entries(row)) {
        if (typeof val === 'string' && val.startsWith('=')) {
          const computed = evaluateFormula(val, data, context)
          result[col] = typeof computed === 'number' ? computed.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(computed)
        } else {
          result[col] = val
        }
      }
      return result
    })
  }, [data, context])

  const handleChange = useCallback((newData) => {
    setData(newData)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      if (onSave) onSave(newData)
    }, 2000)
  }, [onSave])

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [])

  const columns = useMemo(() => {
    return Array.from({ length: NUM_COLS }, (_, i) => ({
      ...keyColumn(COL_LETTERS[i], textColumn),
      title: COL_LETTERS[i],
      minWidth: 120,
    }))
  }, [])

  const activeCellFormula = activeCell != null ? (() => {
    const { row, col } = activeCell
    if (row >= 0 && row < data.length) {
      const val = data[row][COL_LETTERS[col]]
      if (typeof val === 'string' && val.startsWith('=')) return val
    }
    return null
  })() : null

  return (
    <div className="flex flex-col h-full">
      {/* Formula bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-theme-card border-b border-glass-border">
        <span className="text-xs text-slate-500 font-mono w-12">
          {activeCell ? `${COL_LETTERS[activeCell.col]}${activeCell.row + 1}` : ''}
        </span>
        <div className="flex-1 flex items-center gap-2">
          <span className="text-xs text-slate-400 font-mono">fx</span>
          <input
            type="text"
            readOnly
            value={activeCellFormula || ''}
            className="flex-1 bg-theme-base border border-glass-border rounded px-2 py-1 text-sm text-white font-mono focus:outline-none"
            placeholder={t('Selecciona una celda...', 'Select a cell...')}
          />
        </div>
        <button
          onClick={() => setShowFormulas(!showFormulas)}
          className="px-3 py-1 text-xs rounded border transition-colors"
          style={showFormulas ? { backgroundColor: 'rgba(37,99,235,0.2)', color: 'var(--accent-blue)', borderColor: 'rgba(37,99,235,0.3)' } : { color: 'var(--text-muted)', borderColor: '#475569' }}
        >
          {t('Fórmulas', 'Formulas')}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Grid */}
        <div className="flex-1 overflow-auto spreadsheet-container">
          <DynamicDataSheetGrid
            value={data}
            onChange={handleChange}
            columns={columns}
            height={600}
            rowHeight={32}
            headerRowHeight={28}
            onActiveCellChange={({ cell }) => {
              if (cell) setActiveCell({ row: cell.row, col: cell.col })
            }}
          />
        </div>

        {/* Formula reference panel.
            FASE ME3: w-72 fijo sin puerta de breakpoint dejaba la hoja en ~70px
            en un teléfono (288 de ~358 útiles): pantalla inutilizable hasta
            volver a tocar el botón. En pantallas angostas el panel se acota a
            un porcentaje del viewport para que la hoja siga viva al lado. */}
        {showFormulas && (
          <div className="w-72 max-w-[60vw] shrink-0 border-l border-glass-border bg-theme-card overflow-y-auto p-3">
            <h3 className="text-sm font-semibold text-white mb-3">{t('Fórmulas Disponibles', 'Available Formulas')}</h3>
            {FORMULA_CATALOG.map(cat => (
              <div key={cat.category} className="mb-4">
                <h4 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--accent-blue)' }}>{cat.category}</h4>
                <div className="space-y-1.5">
                  {cat.formulas.map(f => (
                    <div key={f.name} className="group">
                      <code className="text-xs font-mono block" style={{ color: 'var(--accent-green)' }}>{f.syntax}</code>
                      <span className="text-xs text-slate-500">{f.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
