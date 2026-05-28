import { Navigate, useOutletContext } from 'react-router-dom'
import Topbar from '../components/Topbar'
import CSVImport from '../components/leads/CSVImport'
import Card from '../components/ui/Card'

export default function ImportPage() {
  const { workspace, workspaceId, user, userRole } = useOutletContext()

  if (userRole === 'readonly') {
    return <Navigate to={`/w/${workspaceId}`} replace />
  }

  return (
    <>
      <Topbar
        title="Import Leads from CSV"
        breadcrumbs={[{ label: workspace.name, to: `/w/${workspaceId}` }, { label: 'Import' }]}
      />
      <div className="px-6 py-4 max-w-3xl">
        <Card>
          <div className="mb-5">
            <p className="text-[13px] text-[color:var(--color-text-muted)] leading-relaxed">
              Upload a CSV file to bulk-import leads. After selecting the file, you'll map each column to a lead field. Required: at least one column mapped to <span className="text-[color:var(--color-text)] font-medium">Address</span>.
            </p>
            <p className="text-[11.5px] text-[color:var(--color-text-dim)] mt-2 leading-relaxed">
              Tip: financial columns like Asking Price and ARV can include $ or commas — they'll be parsed automatically. MAO is auto-calculated from ARV + workspace defaults if not provided.
            </p>
          </div>
          <CSVImport
            workspaceId={workspaceId}
            userId={user.id}
            workspaceDefaults={workspace.settings}
          />
        </Card>
      </div>
    </>
  )
}
