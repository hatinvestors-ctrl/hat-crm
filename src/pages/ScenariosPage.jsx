import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'

const SCENARIO_TYPES = [
  { value: 'introduction', label: 'Introduction' },
  { value: 'reactivation', label: 'Reactivation' },
  { value: 'post_close',   label: 'Post-Close' },
  { value: 'check_in',     label: 'Check-In' },
  { value: 'custom',       label: 'Custom' },
]

const AI_SCENARIO_TYPES = [
  { value: 'intro',        label: 'Intro' },
  { value: 'check_in',     label: 'Check-In' },
  { value: 'reactivation', label: 'Reactivation' },
  { value: 'post_close',   label: 'Post-Close' },
  { value: 'passed_deal',  label: 'Passed Deal' },
]

const inputCls = 'w-full text-[13px] px-2 h-8 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] disabled:opacity-50'

function emptyStep(n) {
  return { step_number: n, day_offset: n === 1 ? 0 : 7, channel: 'email', ai_scenario_type: 'check_in', use_ai: true, requires_approval: true, auto_send: false, min_days_since_last_contact: 7, stop_on_reply: true, subject_override: '', body_override: '' }
}

export default function ScenariosPage() {
  const { workspaceId, userId } = useOutletContext()
  const [scenarios, setScenarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', type: 'introduction' })
  const [steps, setSteps] = useState([emptyStep(1)])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [scenarioSteps, setScenarioSteps] = useState({})

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('outreach_scenarios')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
    setScenarios(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [workspaceId])

  const loadSteps = async (scenarioId) => {
    const { data } = await supabase
      .from('scenario_steps')
      .select('*')
      .eq('scenario_id', scenarioId)
      .order('step_number')
    setScenarioSteps(prev => ({ ...prev, [scenarioId]: data || [] }))
  }

  const openNew = () => {
    setEditing(null)
    setForm({ name: '', description: '', type: 'introduction' })
    setSteps([emptyStep(1)])
    setModalOpen(true)
  }

  const openEdit = async (scenario) => {
    setEditing(scenario)
    setForm({ name: scenario.name, description: scenario.description || '', type: scenario.type })
    const { data } = await supabase.from('scenario_steps').select('*').eq('scenario_id', scenario.id).order('step_number')
    setSteps(data?.length ? data.map(s => ({ ...s, subject_override: s.subject_override || '', body_override: s.body_override || '' })) : [emptyStep(1)])
    setModalOpen(true)
  }

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    setSaveError(null)
    try {
      let scenarioId = editing?.id
      if (!scenarioId) {
        const { data, error } = await supabase.from('outreach_scenarios').insert({ workspace_id: workspaceId, created_by: userId, ...form }).select('id').single()
        if (error) throw new Error(error.message)
        scenarioId = data.id
      } else {
        const { error } = await supabase.from('outreach_scenarios').update({ ...form, updated_at: new Date().toISOString() }).eq('id', scenarioId)
        if (error) throw new Error(error.message)
        await supabase.from('scenario_steps').delete().eq('scenario_id', scenarioId)
      }
      for (const step of steps) {
        const { error } = await supabase.from('scenario_steps').insert({
          scenario_id: scenarioId,
          workspace_id: workspaceId,
          step_number: step.step_number,
          day_offset: Number(step.day_offset) || 0,
          channel: step.channel,
          ai_scenario_type: step.ai_scenario_type || null,
          subject_override: step.subject_override || null,
          body_override: step.body_override || null,
          use_ai: step.use_ai,
          requires_approval: step.requires_approval,
          auto_send: false,
          min_days_since_last_contact: Number(step.min_days_since_last_contact) || 7,
          stop_on_reply: step.stop_on_reply,
        })
        if (error) throw new Error(error.message)
      }
      setModalOpen(false)
      load()
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (scenario) => {
    await supabase.from('outreach_scenarios').update({ is_active: !scenario.is_active }).eq('id', scenario.id)
    setScenarios(prev => prev.map(s => s.id === scenario.id ? { ...s, is_active: !s.is_active } : s))
  }

  const toggleExpand = async (id) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (!scenarioSteps[id]) await loadSteps(id)
  }

  const addStep = () => setSteps(prev => [...prev, emptyStep(prev.length + 1)])
  const removeStep = (i) => setSteps(prev => prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, step_number: idx + 1 })))
  const patchStep = (i, changes) => setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, ...changes } : s))

  const labelCls = 'text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]'

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[17px] font-semibold text-[color:var(--color-text)]">Outreach Scenarios</h1>
          <p className="text-[12.5px] text-[color:var(--color-text-dim)] mt-0.5">Define multi-step email sequences. Enroll agents from their profile.</p>
        </div>
        <Button size="sm" onClick={openNew}>+ New Scenario</Button>
      </div>

      {loading ? (
        <div className="text-[13px] text-[color:var(--color-text-dim)] py-8 text-center">Loading…</div>
      ) : scenarios.length === 0 ? (
        <div className="border border-dashed border-[color:var(--color-line)] rounded-lg p-10 text-center text-[13px] text-[color:var(--color-text-dim)]">
          No scenarios yet. Create one to start automating agent outreach.
        </div>
      ) : (
        <div className="space-y-2">
          {scenarios.map(s => (
            <div key={s.id} className="border border-[color:var(--color-line)] rounded-lg bg-[color:var(--color-bg-elev)]">
              <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => toggleExpand(s.id)} className="flex-1 text-left">
                  <span className="text-[13.5px] font-medium text-[color:var(--color-text)]">{s.name}</span>
                  <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)]">
                    {SCENARIO_TYPES.find(t => t.value === s.type)?.label || s.type}
                  </span>
                </button>
                <button
                  onClick={() => toggleActive(s)}
                  className={`text-[11px] px-2 py-1 rounded font-medium transition-colors ${s.is_active ? 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]' : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]'}`}
                >
                  {s.is_active ? 'Active' : 'Paused'}
                </button>
                <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>Edit</Button>
              </div>
              {expandedId === s.id && (
                <div className="px-4 pb-3 border-t border-[color:var(--color-line)] pt-3 space-y-1.5">
                  {(scenarioSteps[s.id] || []).map(step => (
                    <div key={step.id} className="flex items-center gap-3 text-[12.5px] text-[color:var(--color-text-muted)]">
                      <span className="w-6 h-6 rounded-full bg-[color:var(--color-bg-elev-2)] flex items-center justify-center text-[11px] font-semibold text-[color:var(--color-text-dim)] shrink-0">{step.step_number}</span>
                      <span>Day +{step.day_offset}</span>
                      <span className="capitalize">{step.channel}</span>
                      {step.ai_scenario_type && <span className="text-[color:var(--color-accent-text)]">AI: {step.ai_scenario_type}</span>}
                      {step.requires_approval && <span className="text-[color:var(--color-warn-text)]">Requires approval</span>}
                    </div>
                  ))}
                  {(scenarioSteps[s.id] || []).length === 0 && <div className="text-[12px] text-[color:var(--color-text-dim)]">No steps</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit: ${editing.name}` : 'New Scenario'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!form.name.trim()}>Save Scenario</Button>
          </>
        }
      >
        <div className="space-y-4">
          {saveError && (
            <div className="text-[12px] text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft)] px-3 py-2 rounded">{saveError}</div>
          )}
          <div>
            <label className={labelCls}>Name</label>
            <input className={inputCls + ' mt-1'} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. New Realtor Intro" />
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <select className={inputCls + ' mt-1'} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              {SCENARIO_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Description (optional)</label>
            <input className={inputCls + ' mt-1'} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What this scenario is for" />
          </div>

          <div className="border-t border-[color:var(--color-line)] pt-4">
            <div className="flex items-center justify-between mb-3">
              <span className={labelCls}>Steps ({steps.length})</span>
              <Button variant="ghost" size="sm" onClick={addStep}>+ Add Step</Button>
            </div>
            <div className="space-y-4">
              {steps.map((step, i) => (
                <div key={i} className="border border-[color:var(--color-line)] rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] font-semibold text-[color:var(--color-text)]">Step {step.step_number}</span>
                    {steps.length > 1 && <Button variant="ghost" size="sm" onClick={() => removeStep(i)}>Remove</Button>}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className={labelCls}>Day Offset</label>
                      <input type="number" min="0" className={inputCls + ' mt-1'} value={step.day_offset} onChange={e => patchStep(i, { day_offset: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Channel</label>
                      <select className={inputCls + ' mt-1'} value={step.channel} onChange={e => patchStep(i, { channel: e.target.value })}>
                        <option value="email">Email</option>
                        <option value="task">Task</option>
                        <option value="note">Note</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>AI Type</label>
                      <select className={inputCls + ' mt-1'} value={step.ai_scenario_type || ''} onChange={e => patchStep(i, { ai_scenario_type: e.target.value || null })}>
                        <option value="">— None —</option>
                        {AI_SCENARIO_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelCls}>Min Days Since Last Contact</label>
                      <input type="number" min="0" className={inputCls + ' mt-1'} value={step.min_days_since_last_contact} onChange={e => patchStep(i, { min_days_since_last_contact: e.target.value })} />
                    </div>
                    <div className="flex items-end gap-3 pb-1">
                      <label className="flex items-center gap-1.5 text-[12.5px] text-[color:var(--color-text-muted)] cursor-pointer">
                        <input type="checkbox" checked={step.requires_approval} onChange={e => patchStep(i, { requires_approval: e.target.checked })} />
                        Requires approval
                      </label>
                      <label className="flex items-center gap-1.5 text-[12.5px] text-[color:var(--color-text-muted)] cursor-pointer">
                        <input type="checkbox" checked={step.stop_on_reply} onChange={e => patchStep(i, { stop_on_reply: e.target.checked })} />
                        Stop on reply
                      </label>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
