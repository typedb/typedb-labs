// Colours and wording for TypeDB type labels. Which types exist, and every instance, come from
// the API; a type without an entry here still appears, in neutral grey.
import { Building2, Landmark, Scale, Briefcase, User, type LucideIcon } from 'lucide-react'
import { humanise } from '@/lib/format'

export type Tone = { stroke: string; soft: string; text: string; label: string; dash?: string; width?: number }

export const RELATION_STYLE: Record<string, Tone> = {
  acquisition: { stroke: '#0f2a44', soft: '#e7edf4', text: '#0f2a44', label: 'Acquisition', width: 3 },
  mandate: { stroke: '#7c5cc4', soft: '#f1ecfb', text: '#5b3fa3', label: 'Mandate' },
  financing: { stroke: '#2f6fd1', soft: '#e9f1fd', text: '#1f57ad', label: 'Financing' },
  'authority-review': { stroke: '#c7811c', soft: '#fdf3e2', text: '#9a5f0b', label: 'Regulatory review', dash: '6 4' },
  ownership: { stroke: '#138a7e', soft: '#e3f5f2', text: '#0d6e64', label: 'Ownership' },
  employment: { stroke: '#94a3b8', soft: '#f1f5f9', text: '#475569', label: 'Employment', dash: '3 3', width: 1.25 },
}
export const relationStyle = (type: string): Tone =>
  RELATION_STYLE[type] ?? { stroke: '#94a3b8', soft: '#f1f5f9', text: '#475569', label: humanise(type) }

// Organisation families: the type directly below "organisation" in the schema.
export const FAMILY_STYLE: Record<string, { icon: LucideIcon; ring: string; chip: string; dot: string }> = {
  company: { icon: Building2, ring: 'ring-ink/25', chip: 'bg-ink text-white', dot: '#0f2a44' },
  'financial-institution': { icon: Landmark, ring: 'ring-[#2f6fd1]/30', chip: 'bg-[#e9f1fd] text-[#1f57ad]', dot: '#2f6fd1' },
  'professional-services-firm': { icon: Briefcase, ring: 'ring-[#7c5cc4]/30', chip: 'bg-[#f1ecfb] text-[#5b3fa3]', dot: '#7c5cc4' },
  authority: { icon: Scale, ring: 'ring-[#c7811c]/35', chip: 'bg-[#fdf3e2] text-[#9a5f0b]', dot: '#c7811c' },
  person: { icon: User, ring: 'ring-slate-300', chip: 'bg-slate-100 text-slate-600', dot: '#94a3b8' },
}

/** The family of a node from its type path (["law-firm", "professional-services-firm", "organisation", "party"]). */
export function familyOf(typePath: string[]): string {
  const i = typePath.indexOf('organisation')
  return i > 0 ? typePath[i - 1] : typePath[0] === 'person' ? 'person' : typePath[0]
}
export const familyStyle = (family: string) => FAMILY_STYLE[family] ?? FAMILY_STYLE.company

/** "Mandate (adviser → client)" style sentence parts for a role name. */
export const roleLabel = (role: string) => humanise(role)
