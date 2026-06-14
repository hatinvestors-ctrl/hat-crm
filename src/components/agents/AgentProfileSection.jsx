import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { AGENT_TYPES, RELATIONSHIP_STATUSES } from '../../lib/constants'

const REL_STATUS_COLORS = {
  new:            'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)]',
  contacted:      'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]',
  active:         'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]',
  warm:           'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]',
  high_value:     'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)] font-semibold',
  dormant:        'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]',
  do_not_contact: 'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)]',
}

const inputCls = 'w-full text-[13px] px-2 h-8 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] disabled:opacity-50'

export default function AgentProfileSection({ agent, canEdit, onUpdated }) {
  const [saving, setSaving] = useState(null)

  const patch = async (field, value) => {
    setSaving(field)
    const { data, error } = await supabase
      .from('agents')
      .update({ [field]: value })
      .eq('id', agent.id)
      .select('*')
      .single()
    setSaving(null)
    if (!error && data) onUpdated?.(data)
  }

  const label = (text) => (
    <label className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">{text}</label>
  )

  return (
    <div className="space-y-3">
      {/* Relationship Status */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          {label('Relationship Status')}
          {canEdit ? (
            <select
              value={agent.relationship_status || 'new'}
              onChange={e => patch('relationship_status', e.target.value)}
              disabled={saving === 'relationship_status'}
              className={inputCls + ' mt-1'}
            >
              {RELATIONSHIP_STATUSES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          ) : (
            <div className="mt-1">
              <span className={`inline-flex items-center px-2 h-6 rounded text-[11px] ${REL_STATUS_COLORS[agent.relationship_status] || REL_STATUS_COLORS.new}`}>
                {RELATIONSHIP_STATUSES.find(s => s.value === agent.relationship_status)?.label || 'New'}
              </span>
            </div>
          )}
        </div>

        {/* Strategic flag */}
        <div className="flex-shrink-0 pt-5">
          <button
            type="button"
            onClick={() => canEdit && patch('is_strategic', !agent.is_strategic)}
            disabled={!canEdit}
            title={agent.is_strategic ? 'Strategic (click to remove)' : 'Mark as strategic'}
            className={`text-xl transition-opacity ${!canEdit ? 'cursor-default opacity-50' : 'cursor-pointer'} ${agent.is_strategic ? 'opacity-100' : 'opacity-20 hover:opacity-60'}`}
          >
            ⭐
          </button>
        </div>
      </div>

      {/* Agent Type */}
      <div>
        {label('Contact Type')}
        {canEdit ? (
          <select
            value={agent.agent_type || 'realtor'}
            onChange={e => patch('agent_type', e.target.value)}
            disabled={saving === 'agent_type'}
            className={inputCls + ' mt-1'}
          >
            {AGENT_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        ) : (
          <div className="mt-1 text-[13px] text-[color:var(--color-text)]">
            {AGENT_TYPES.find(t => t.value === agent.agent_type)?.label || 'Realtor'}
          </div>
        )}
      </div>

      {/* Preferred Contact */}
      <div>
        {label('Preferred Contact')}
        {canEdit ? (
          <select
            value={agent.preferred_contact || 'email'}
            onChange={e => patch('preferred_contact', e.target.value)}
            disabled={saving === 'preferred_contact'}
            className={inputCls + ' mt-1'}
          >
            {[
              { value: 'email', label: 'Email' },
              { value: 'text', label: 'Text' },
              { value: 'call', label: 'Call' },
              { value: 'linkedin', label: 'LinkedIn' },
            ].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <div className="mt-1 text-[13px] text-[color:var(--color-text)] capitalize">
            {agent.preferred_contact || 'Email'}
          </div>
        )}
      </div>

      {/* Source */}
      <div>
        {label('Source')}
        <input
          type="text"
          defaultValue={agent.source || ''}
          disabled={!canEdit}
          placeholder="How we found them"
          onBlur={e => {
            const v = e.target.value.trim() || null
            if (v !== (agent.source || null)) patch('source', v)
          }}
          className={inputCls + ' mt-1'}
        />
      </div>

      {/* LinkedIn URL */}
      <div>
        {label('LinkedIn')}
        <input
          type="url"
          defaultValue={agent.linkedin_url || ''}
          disabled={!canEdit}
          placeholder="https://linkedin.com/in/..."
          onBlur={e => {
            const v = e.target.value.trim() || null
            if (v !== (agent.linkedin_url || null)) patch('linkedin_url', v)
          }}
          className={inputCls + ' mt-1'}
        />
      </div>

      {/* Market Areas */}
      <div>
        {label('Market Areas (ZIP codes)')}
        <input
          type="text"
          defaultValue={(agent.market_areas || []).join(', ')}
          disabled={!canEdit}
          placeholder="32210, 32244, 32256"
          onBlur={e => {
            const parsed = e.target.value.split(',').map(t => t.trim()).filter(Boolean)
            const cur = agent.market_areas || []
            const changed = parsed.length !== cur.length || parsed.some((v, i) => v !== cur[i])
            if (changed) patch('market_areas', parsed)
          }}
          className={inputCls + ' mt-1'}
        />
      </div>

      {/* Tags */}
      <div>
        {label('Tags')}
        <input
          type="text"
          defaultValue={(agent.tags || []).join(', ')}
          disabled={!canEdit}
          placeholder="comma, separated, tags"
          onBlur={e => {
            const parsed = e.target.value.split(',').map(t => t.trim()).filter(Boolean)
            const cur = agent.tags || []
            const changed = parsed.length !== cur.length || parsed.some((v, i) => v !== cur[i])
            if (changed) patch('tags', parsed)
          }}
          className={inputCls + ' mt-1'}
        />
        {(agent.tags || []).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {agent.tags.map(t => (
              <span key={t} className="inline-flex items-center px-1.5 h-[18px] rounded text-[10.5px] bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)]">{t}</span>
            ))}
          </div>
        )}
      </div>

      {/* DNC Reason */}
      {agent.relationship_status === 'do_not_contact' && (
        <div>
          {label('DNC Reason')}
          <input
            type="text"
            defaultValue={agent.do_not_contact_reason || ''}
            disabled={!canEdit}
            placeholder="Why do not contact?"
            onBlur={e => {
              const v = e.target.value.trim() || null
              if (v !== (agent.do_not_contact_reason || null)) patch('do_not_contact_reason', v)
            }}
            className={inputCls + ' mt-1'}
          />
        </div>
      )}

      {saving && (
        <div className="text-[10.5px] text-[color:var(--color-text-dim)] italic">Saving…</div>
      )}
    </div>
  )
}
