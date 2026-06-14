import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import SearchableSelect from '../ui/SearchableSelect'

export default function AgentScenarioPanel({ agent, workspaceId, userId, canEdit }) {
  const [enrollments, setEnrollments] = useState([])
  const [scenarios, setScenarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [selectedScenario, setSelectedScenario] = useState('')
  const [enrolling, setEnrolling] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: enr }, { data: scen }] = await Promise.all([
      supabase
        .from('scenario_enrollments')
        .select('*, scenario:outreach_scenarios(name, type)')
        .eq('agent_id', agent.id)
        .order('enrolled_at', { ascending: false })
        .limit(5),
      supabase
        .from('outreach_scenarios')
        .select('id, name, type')
        .eq('workspace_id', workspaceId)
        .eq('is_active', true)
        .order('name'),
    ])
    setEnrollments(enr || [])
    setScenarios(scen || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [agent.id])

  const handleEnroll = async () => {
    if (!selectedScenario) return
    setEnrolling(true)
    const { data: steps } = await supabase
      .from('scenario_steps')
      .select('*')
      .eq('scenario_id', selectedScenario)
      .order('step_number')
      .limit(1)
    const step1 = steps?.[0]

    const { data: enrollment } = await supabase
      .from('scenario_enrollments')
      .insert({ workspace_id: workspaceId, agent_id: agent.id, scenario_id: selectedScenario, enrolled_by: userId })
      .select('id')
      .single()

    if (enrollment && step1) {
      const scheduledFor = new Date()
      scheduledFor.setDate(scheduledFor.getDate() + (step1.day_offset || 0))
      await supabase.from('scheduled_messages').insert({
        workspace_id: workspaceId,
        agent_id: agent.id,
        enrollment_id: enrollment.id,
        step_id: step1.id,
        scheduled_for: scheduledFor.toISOString().slice(0, 10),
        channel: step1.channel || 'email',
        status: 'pending',
      })
    }

    setEnrollOpen(false)
    setSelectedScenario('')
    setEnrolling(false)
    load()
  }

  const handleCancel = async (enrollmentId) => {
    await supabase
      .from('scenario_enrollments')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_reason: 'manually_cancelled' })
      .eq('id', enrollmentId)
    load()
  }

  const STATUS_COLORS = {
    active:        'text-[color:var(--color-success-text)] bg-[color:var(--color-success-soft)]',
    paused:        'text-[color:var(--color-warn-text)] bg-[color:var(--color-warn-soft)]',
    completed:     'text-[color:var(--color-text-dim)] bg-[color:var(--color-bg-elev-2)]',
    cancelled:     'text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft)]',
    stopped_reply: 'text-[color:var(--color-text-muted)] bg-[color:var(--color-bg-elev-2)]',
  }

  const active = enrollments.filter(e => e.status === 'active')
  const past   = enrollments.filter(e => e.status !== 'active')

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Scenario Enrollments</span>
        {canEdit && scenarios.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setEnrollOpen(true)}>+ Enroll</Button>
        )}
      </div>

      {loading ? (
        <div className="text-[12px] text-[color:var(--color-text-dim)]">Loading…</div>
      ) : enrollments.length === 0 ? (
        <div className="text-[12.5px] text-[color:var(--color-text-dim)]">Not enrolled in any scenarios.</div>
      ) : (
        <div className="space-y-1.5">
          {[...active, ...past].map(e => (
            <div key={e.id} className="flex items-center gap-2 text-[12.5px]">
              <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-medium ${STATUS_COLORS[e.status] || ''}`}>{e.status}</span>
              <span className="text-[color:var(--color-text)]">{e.scenario?.name || '—'}</span>
              <span className="text-[color:var(--color-text-dim)]">step {e.current_step}</span>
              {e.status === 'active' && canEdit && (
                <button onClick={() => handleCancel(e.id)} className="ml-auto text-[11px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-danger-text)] transition-colors">Cancel</button>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        title="Enroll in Scenario"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEnrollOpen(false)}>Cancel</Button>
            <Button onClick={handleEnroll} loading={enrolling} disabled={!selectedScenario}>Enroll</Button>
          </>
        }
      >
        <SearchableSelect
          value={selectedScenario}
          onChange={setSelectedScenario}
          options={scenarios.map(s => ({ value: s.id, label: s.name }))}
          placeholder="Select a scenario…"
        />
      </Modal>
    </div>
  )
}
