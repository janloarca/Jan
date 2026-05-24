import {
  TrendingUp, Bitcoin, Landmark, Briefcase, Building2,
  Home, Gem, CreditCard, BarChart3, ArrowUp, ArrowDown,
  Search, Settings, Plus, Upload, Download, Share2,
  RefreshCw, LogOut, ChevronLeft, ChevronRight, X,
  Menu, MoreHorizontal, Filter, Calendar, DollarSign,
  PieChart, Activity, Bell, AlertTriangle, Check,
  FileText, Printer, Zap, Globe, Sun, Moon,
  ArrowLeftRight, Eye, Edit3, Trash2, ExternalLink,
  Calculator, Target,
} from 'lucide-react'

const iconMap = {
  TrendingUp, Bitcoin, Landmark, Briefcase, Building2,
  Home, Gem, CreditCard, BarChart3, ArrowUp, ArrowDown,
  Search, Settings, Plus, Upload, Download, Share2,
  RefreshCw, LogOut, ChevronLeft, ChevronRight, X,
  Menu, MoreHorizontal, Filter, Calendar, DollarSign,
  PieChart, Activity, Bell, AlertTriangle, Check,
  FileText, Printer, Zap, Globe, Sun, Moon,
  ArrowLeftRight, Eye, Edit3, Trash2, ExternalLink,
  Calculator, Target,
}

export default function Icon({ name, size = 16, className = '', ...props }) {
  const IconComponent = iconMap[name]
  if (!IconComponent) return <span className={className}>{name}</span>
  return <IconComponent size={size} className={className} {...props} />
}

export { iconMap }
