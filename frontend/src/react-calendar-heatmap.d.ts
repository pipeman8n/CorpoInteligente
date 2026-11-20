declare module 'react-calendar-heatmap' {
  import { Component } from 'react'

  export interface HeatmapValue {
    date: string | Date
    count?: number
    [key: string]: unknown
  }

  export interface CalendarHeatmapProps {
    values: HeatmapValue[]
    startDate?: Date | string
    endDate?: Date | string
    classForValue?: (value: HeatmapValue | null) => string
    titleForValue?: (value: HeatmapValue | null) => string
    tooltipDataAttrs?: (value: HeatmapValue | null) => Record<string, unknown>
    showWeekdayLabels?: boolean
    showMonthLabels?: boolean
    monthLabels?: string[]
    weekdayLabels?: string[]
    horizontal?: boolean
    gutterSize?: number
    onClick?: (value: HeatmapValue | null) => void
    [key: string]: unknown
  }

  export default class CalendarHeatmap extends Component<CalendarHeatmapProps> {}
}
