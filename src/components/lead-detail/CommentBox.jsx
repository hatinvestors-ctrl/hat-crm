import { useState } from 'react'
import Button from '../ui/Button'
import { logComment } from '../../lib/activityLogger'

export default function CommentBox({ leadId, userId, onPosted }) {
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)

  const post = async () => {
    if (!text.trim()) return
    setPosting(true)
    await logComment(leadId, userId, text)
    setText('')
    setPosting(false)
    onPosted?.()
  }

  return (
    <div className="bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg p-3 focus-within:border-[color:var(--color-accent)] focus-within:ring-1 focus-within:ring-[color:var(--color-accent)] transition-colors">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Leave a comment…"
        rows={2}
        className="w-full text-[13px] text-[color:var(--color-text)] bg-transparent placeholder:text-[color:var(--color-text-faint)] resize-none focus:outline-none leading-relaxed"
      />
      <div className="flex justify-end">
        <Button size="sm" onClick={post} loading={posting} disabled={!text.trim()}>Post</Button>
      </div>
    </div>
  )
}
