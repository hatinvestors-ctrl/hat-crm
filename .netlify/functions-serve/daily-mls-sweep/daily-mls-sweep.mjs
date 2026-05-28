
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


// netlify/functions/daily-mls-sweep.mjs
var SUPABASE_PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "pyrgotfotmwazigewlke";
var SUPABASE_PAT = process.env.SUPABASE_PAT;
var RENTCAST_API_KEY = process.env.RENTCAST_API_KEY;
var TERMINAL_STATUSES = "('sold','dead_lead','rejected_not_accepted','not_in_buy_box','sequence_completed')";
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPABASE_PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`SQL error ${r.status}: ${text}`);
  return JSON.parse(text);
}
function workspaceCurrentHour(timezone) {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: timezone || "Asia/Jerusalem" });
    const parts = fmt.formatToParts(/* @__PURE__ */ new Date());
    const hourPart = parts.find((p) => p.type === "hour");
    return Number(hourPart?.value ?? (/* @__PURE__ */ new Date()).getUTCHours());
  } catch (_) {
    return (/* @__PURE__ */ new Date()).getUTCHours();
  }
}
async function enrichOne(leadId) {
  const r = await fetch(`https://${process.env.URL?.replace(/^https?:\/\//, "") || "localhost:8888"}/.netlify/functions/enrich-lead`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lead_id: leadId, force: true })
  });
  return r.ok;
}
var daily_mls_sweep_default = async () => {
  if (!SUPABASE_PAT || !RENTCAST_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "Missing env vars" }), { status: 500 });
  }
  const workspaces = await sql(`select id, name, settings from public.workspaces where (settings->>'mls_sweep_enabled')::boolean = true and coalesce((settings->>'mls_paused')::boolean, false) = false`);
  const results = [];
  for (const w of workspaces) {
    const tz = w.settings?.mls_sweep_timezone || "Asia/Jerusalem";
    const targetHour = Number(w.settings?.mls_sweep_hour ?? 5);
    const currentHour = workspaceCurrentHour(tz);
    if (currentHour !== targetHour) {
      results.push({ workspace: w.name, skipped: true, reason: `current ${tz} hour ${currentHour} \u2260 target ${targetHour}` });
      continue;
    }
    const cap = Number(w.settings?.mls_sweep_max_leads ?? 100);
    const rows = await sql(`
      select id from public.leads
      where workspace_id = '${w.id}'
        and status not in ${TERMINAL_STATUSES}
        and (mls_last_checked is null or mls_last_checked < now() - interval '12 hours')
      order by mls_last_checked asc nulls first
      limit ${cap}
    `);
    let ok = 0, fail = 0;
    for (const r of rows) {
      try {
        const success = await enrichOne(r.id);
        if (success) ok++;
        else fail++;
      } catch (_) {
        fail++;
      }
    }
    results.push({ workspace: w.name, processed: ok, failed: fail, total: rows.length });
  }
  return new Response(JSON.stringify({ ok: true, ran_at: (/* @__PURE__ */ new Date()).toISOString(), results }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};
var config = {
  schedule: "7 * * * *"
};
export {
  config,
  daily_mls_sweep_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMvZGFpbHktbWxzLXN3ZWVwLm1qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gRGFpbHkgTUxTIGVucmljaG1lbnQgc3dlZXAuXG4vL1xuLy8gUnVucyBldmVyeSBob3VyLiBGb3IgZWFjaCB3b3Jrc3BhY2Ugd2hlcmUgc2V0dGluZ3MubWxzX3N3ZWVwX2VuYWJsZWQgaXMgdHJ1ZSxcbi8vIGFuZCB0aGUgd29ya3NwYWNlLWxvY2FsIGhvdXIgbWF0Y2hlcyBzZXR0aW5ncy5tbHNfc3dlZXBfaG91ciwgcmVmcmVzaFxuLy8gTUxTIHN0YXR1cyBmb3IgYWxsIG5vbi10ZXJtaW5hbCBsZWFkcyB0aGF0IGhhdmVuJ3QgYmVlbiBjaGVja2VkIGluIDEyaCsuXG4vL1xuLy8gVGhpcyBtYWtlcyB0aGUgc3dlZXAgY29uZmlndXJhYmxlIHBlci13b3Jrc3BhY2UgV0lUSE9VVCByZWRlcGxveWluZzpcbi8vIHRoZSB1c2VyIHBpY2tzIHRoZSBob3VyICsgdGltZXpvbmUgZnJvbSB0aGUgU2V0dGluZ3MgcGFnZSBhbmQgaXQganVzdCB3b3Jrcy5cblxuY29uc3QgU1VQQUJBU0VfUFJPSkVDVF9SRUYgPSBwcm9jZXNzLmVudi5TVVBBQkFTRV9QUk9KRUNUX1JFRiB8fCAncHlyZ290Zm90bXdhemlnZXdsa2UnXG5jb25zdCBTVVBBQkFTRV9QQVQgPSBwcm9jZXNzLmVudi5TVVBBQkFTRV9QQVRcbmNvbnN0IFJFTlRDQVNUX0FQSV9LRVkgPSBwcm9jZXNzLmVudi5SRU5UQ0FTVF9BUElfS0VZXG5jb25zdCBSRU5UQ0FTVF9CQVNFID0gJ2h0dHBzOi8vYXBpLnJlbnRjYXN0LmlvL3YxJ1xuXG5jb25zdCBURVJNSU5BTF9TVEFUVVNFUyA9IFwiKCdzb2xkJywnZGVhZF9sZWFkJywncmVqZWN0ZWRfbm90X2FjY2VwdGVkJywnbm90X2luX2J1eV9ib3gnLCdzZXF1ZW5jZV9jb21wbGV0ZWQnKVwiXG5cbmFzeW5jIGZ1bmN0aW9uIHNxbChxdWVyeSkge1xuICBjb25zdCByID0gYXdhaXQgZmV0Y2goYGh0dHBzOi8vYXBpLnN1cGFiYXNlLmNvbS92MS9wcm9qZWN0cy8ke1NVUEFCQVNFX1BST0pFQ1RfUkVGfS9kYXRhYmFzZS9xdWVyeWAsIHtcbiAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICBoZWFkZXJzOiB7IEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHtTVVBBQkFTRV9QQVR9YCwgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgcXVlcnkgfSksXG4gIH0pXG4gIGNvbnN0IHRleHQgPSBhd2FpdCByLnRleHQoKVxuICBpZiAoIXIub2spIHRocm93IG5ldyBFcnJvcihgU1FMIGVycm9yICR7ci5zdGF0dXN9OiAke3RleHR9YClcbiAgcmV0dXJuIEpTT04ucGFyc2UodGV4dClcbn1cblxuZnVuY3Rpb24gd29ya3NwYWNlQ3VycmVudEhvdXIodGltZXpvbmUpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBmbXQgPSBuZXcgSW50bC5EYXRlVGltZUZvcm1hdCgnZW4tVVMnLCB7IGhvdXI6ICdudW1lcmljJywgaG91cjEyOiBmYWxzZSwgdGltZVpvbmU6IHRpbWV6b25lIHx8ICdBc2lhL0plcnVzYWxlbScgfSlcbiAgICBjb25zdCBwYXJ0cyA9IGZtdC5mb3JtYXRUb1BhcnRzKG5ldyBEYXRlKCkpXG4gICAgY29uc3QgaG91clBhcnQgPSBwYXJ0cy5maW5kKHAgPT4gcC50eXBlID09PSAnaG91cicpXG4gICAgcmV0dXJuIE51bWJlcihob3VyUGFydD8udmFsdWUgPz8gbmV3IERhdGUoKS5nZXRVVENIb3VycygpKVxuICB9IGNhdGNoIChfKSB7XG4gICAgcmV0dXJuIG5ldyBEYXRlKCkuZ2V0VVRDSG91cnMoKVxuICB9XG59XG5cbi8vIFRpbnkgaW5saW5lIGVucmljaG1lbnQgXHUyMDE0IHNhbWUgc2hhcGUgYXMgdGhlIG9uLWRlbWFuZCBmdW5jdGlvbiwgYnV0IGNhbGxlZFxuLy8gZGlyZWN0bHkgaGVyZSB0byBhdm9pZCBhbiBleHRyYSBIVFRQIGhvcC5cbmFzeW5jIGZ1bmN0aW9uIGVucmljaE9uZShsZWFkSWQpIHtcbiAgY29uc3QgciA9IGF3YWl0IGZldGNoKGBodHRwczovLyR7cHJvY2Vzcy5lbnYuVVJMPy5yZXBsYWNlKC9eaHR0cHM/OlxcL1xcLy8sICcnKSB8fCAnbG9jYWxob3N0Ojg4ODgnfS8ubmV0bGlmeS9mdW5jdGlvbnMvZW5yaWNoLWxlYWRgLCB7XG4gICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgaGVhZGVyczogeyAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBsZWFkX2lkOiBsZWFkSWQsIGZvcmNlOiB0cnVlIH0pLFxuICB9KVxuICByZXR1cm4gci5va1xufVxuXG5leHBvcnQgZGVmYXVsdCBhc3luYyAoKSA9PiB7XG4gIGlmICghU1VQQUJBU0VfUEFUIHx8ICFSRU5UQ0FTVF9BUElfS0VZKSB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IG9rOiBmYWxzZSwgZXJyb3I6ICdNaXNzaW5nIGVudiB2YXJzJyB9KSwgeyBzdGF0dXM6IDUwMCB9KVxuICB9XG5cbiAgLy8gUHVsbCB3b3Jrc3BhY2VzIHdpdGggc3dlZXAgZW5hYmxlZCBBTkQgbm90IHBhdXNlZFxuICBjb25zdCB3b3Jrc3BhY2VzID0gYXdhaXQgc3FsKGBzZWxlY3QgaWQsIG5hbWUsIHNldHRpbmdzIGZyb20gcHVibGljLndvcmtzcGFjZXMgd2hlcmUgKHNldHRpbmdzLT4+J21sc19zd2VlcF9lbmFibGVkJyk6OmJvb2xlYW4gPSB0cnVlIGFuZCBjb2FsZXNjZSgoc2V0dGluZ3MtPj4nbWxzX3BhdXNlZCcpOjpib29sZWFuLCBmYWxzZSkgPSBmYWxzZWApXG4gIGNvbnN0IHJlc3VsdHMgPSBbXVxuXG4gIGZvciAoY29uc3QgdyBvZiB3b3Jrc3BhY2VzKSB7XG4gICAgY29uc3QgdHogPSB3LnNldHRpbmdzPy5tbHNfc3dlZXBfdGltZXpvbmUgfHwgJ0FzaWEvSmVydXNhbGVtJ1xuICAgIGNvbnN0IHRhcmdldEhvdXIgPSBOdW1iZXIody5zZXR0aW5ncz8ubWxzX3N3ZWVwX2hvdXIgPz8gNSkgIC8vIGRlZmF1bHQgNWFtXG4gICAgY29uc3QgY3VycmVudEhvdXIgPSB3b3Jrc3BhY2VDdXJyZW50SG91cih0eilcbiAgICBpZiAoY3VycmVudEhvdXIgIT09IHRhcmdldEhvdXIpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7IHdvcmtzcGFjZTogdy5uYW1lLCBza2lwcGVkOiB0cnVlLCByZWFzb246IGBjdXJyZW50ICR7dHp9IGhvdXIgJHtjdXJyZW50SG91cn0gXHUyMjYwIHRhcmdldCAke3RhcmdldEhvdXJ9YCB9KVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICAvLyBQaWNrIGxlYWRzIHRvIHJlZnJlc2ggXHUyMDE0IG5vbi10ZXJtaW5hbCwgc3RhbGUgKG9yIG5ldmVyLWNoZWNrZWQpXG4gICAgY29uc3QgY2FwID0gTnVtYmVyKHcuc2V0dGluZ3M/Lm1sc19zd2VlcF9tYXhfbGVhZHMgPz8gMTAwKVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBzcWwoYFxuICAgICAgc2VsZWN0IGlkIGZyb20gcHVibGljLmxlYWRzXG4gICAgICB3aGVyZSB3b3Jrc3BhY2VfaWQgPSAnJHt3LmlkfSdcbiAgICAgICAgYW5kIHN0YXR1cyBub3QgaW4gJHtURVJNSU5BTF9TVEFUVVNFU31cbiAgICAgICAgYW5kIChtbHNfbGFzdF9jaGVja2VkIGlzIG51bGwgb3IgbWxzX2xhc3RfY2hlY2tlZCA8IG5vdygpIC0gaW50ZXJ2YWwgJzEyIGhvdXJzJylcbiAgICAgIG9yZGVyIGJ5IG1sc19sYXN0X2NoZWNrZWQgYXNjIG51bGxzIGZpcnN0XG4gICAgICBsaW1pdCAke2NhcH1cbiAgICBgKVxuXG4gICAgbGV0IG9rID0gMCwgZmFpbCA9IDBcbiAgICBmb3IgKGNvbnN0IHIgb2Ygcm93cykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc3VjY2VzcyA9IGF3YWl0IGVucmljaE9uZShyLmlkKVxuICAgICAgICBpZiAoc3VjY2Vzcykgb2srKzsgZWxzZSBmYWlsKytcbiAgICAgIH0gY2F0Y2ggKF8pIHsgZmFpbCsrIH1cbiAgICB9XG4gICAgcmVzdWx0cy5wdXNoKHsgd29ya3NwYWNlOiB3Lm5hbWUsIHByb2Nlc3NlZDogb2ssIGZhaWxlZDogZmFpbCwgdG90YWw6IHJvd3MubGVuZ3RoIH0pXG4gIH1cblxuICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgb2s6IHRydWUsIHJhbl9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLCByZXN1bHRzIH0pLCB7XG4gICAgc3RhdHVzOiAyMDAsXG4gICAgaGVhZGVyczogeyAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXG4gIH0pXG59XG5cbi8vIFJ1biBldmVyeSBob3VyIGF0IG1pbnV0ZSA6MDcgKG9mZnNldCBmcm9tIHRoZSBvbi1kZW1hbmQgdG8gc3ByZWFkIEFQSSBsb2FkKVxuZXhwb3J0IGNvbnN0IGNvbmZpZyA9IHtcbiAgc2NoZWR1bGU6ICc3ICogKiAqIConLFxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7OztBQVNBLElBQU0sdUJBQXVCLFFBQVEsSUFBSSx3QkFBd0I7QUFDakUsSUFBTSxlQUFlLFFBQVEsSUFBSTtBQUNqQyxJQUFNLG1CQUFtQixRQUFRLElBQUk7QUFHckMsSUFBTSxvQkFBb0I7QUFFMUIsZUFBZSxJQUFJLE9BQU87QUFDeEIsUUFBTSxJQUFJLE1BQU0sTUFBTSx3Q0FBd0Msb0JBQW9CLG1CQUFtQjtBQUFBLElBQ25HLFFBQVE7QUFBQSxJQUNSLFNBQVMsRUFBRSxlQUFlLFVBQVUsWUFBWSxJQUFJLGdCQUFnQixtQkFBbUI7QUFBQSxJQUN2RixNQUFNLEtBQUssVUFBVSxFQUFFLE1BQU0sQ0FBQztBQUFBLEVBQ2hDLENBQUM7QUFDRCxRQUFNLE9BQU8sTUFBTSxFQUFFLEtBQUs7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
