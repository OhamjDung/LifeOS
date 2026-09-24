'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ContactTier, ContactCategory, CONTACT_CATEGORIES, CONTACT_CATEGORY_COLOR } from '@/lib/types'

const CONTACT_TIERS: { value: ContactTier; label: string; sub: string }[] = [
  { value: 'daily',    label: 'Daily',    sub: 'every day' },
  { value: 'weekly',   label: 'Weekly',   sub: 'every 7 days' },
  { value: 'biweekly', label: 'Biweekly', sub: 'every 14 days' },
  { value: 'monthly',  label: 'Monthly',  sub: 'every 30 days' },
]

export default function NewContactPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [education, setEducation] = useState('')
  const [location, setLocation] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [linkedin, setLinkedin] = useState('')
  const [howWeMet, setHowWeMet] = useState('')
  const [whyGoodContact, setWhyGoodContact] = useState('')
  const [lessUsefulFor, setLessUsefulFor] = useState('')
  const [rating, setRating] = useState('')
  const [nextStep, setNextStep] = useState('')
  const [tier, setTier] = useState<ContactTier>('weekly')
  const [category, setCategory] = useState<ContactCategory | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('contacts')
      .insert({
        name: name.trim(),
        title: title.trim() || null,
        education: education.trim() || null,
        location: location.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        linkedin: linkedin.trim() || null,
        how_we_met: howWeMet.trim() || null,
        why_good_contact: whyGoodContact.trim() || null,
        less_useful_for: lessUsefulFor.trim() || null,
        rating: rating.trim() || null,
        next_step: nextStep.trim() || null,
        relationship_tier: 'friend',
        contact_tier: tier,
        category,
        user_id: user?.id,
      })
      .select('id')
      .single()
    if (!error && data) {
      router.push(`/contacts/${data.id}`)
    } else {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 sm:p-8 max-w-lg">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-300 text-sm">
          ← Back
        </button>
        <h2 className="text-xl font-bold text-white">New contact</h2>
      </div>

      <div className="space-y-5">
        <div>
          <label className="block text-sm text-gray-400 mb-1.5">Name *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Full name"
            autoFocus
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 outline-none focus:border-indigo-500"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Title</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Role, company"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Education</label>
            <input type="text" value={education} onChange={e => setEducation(e.target.value)} placeholder="School, degree"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Location</label>
            <input type="text" value={location} onChange={e => setLocation(e.target.value)} placeholder="City, state"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Email</label>
            <input type="text" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Phone</label>
            <input type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone number"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">LinkedIn</label>
            <input type="text" value={linkedin} onChange={e => setLinkedin(e.target.value)} placeholder="URL or status"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 outline-none focus:border-indigo-500" />
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1.5">How we met</label>
          <input
            type="text"
            value={howWeMet}
            onChange={e => setHowWeMet(e.target.value)}
            placeholder="College, work, conference…"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1.5">Why they're a good contact</label>
          <textarea value={whyGoodContact} onChange={e => setWhyGoodContact(e.target.value)} rows={3}
            placeholder="Relevant background, shared interests, generous with time…"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 outline-none focus:border-indigo-500 resize-none" />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1.5">Less useful for</label>
          <input type="text" value={lessUsefulFor} onChange={e => setLessUsefulFor(e.target.value)}
            placeholder="Where their expertise doesn't apply"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 outline-none focus:border-indigo-500" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Rating / debrief</label>
            <input type="text" value={rating} onChange={e => setRating(e.target.value)} placeholder="How the meeting went"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Next step</label>
            <input type="text" value={nextStep} onChange={e => setNextStep(e.target.value)} placeholder="Follow-up plan"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 outline-none focus:border-indigo-500" />
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1.5">Category</label>
          <div className="flex flex-wrap gap-2">
            {CONTACT_CATEGORIES.map(c => (
              <button
                key={c}
                type="button"
                aria-pressed={category === c}
                onClick={() => setCategory(category === c ? null : c)}
                className="px-3 py-1.5 rounded-full border text-sm capitalize"
                style={{
                  borderColor: category === c ? CONTACT_CATEGORY_COLOR[c] : 'rgba(28,26,20,0.15)',
                  background: category === c ? CONTACT_CATEGORY_COLOR[c] : 'transparent',
                  color: category === c ? '#F3F1EA' : '#6B6358',
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1.5">Contact frequency</label>
          <div className="grid grid-cols-2 gap-2">
            {CONTACT_TIERS.map(t => (
              <button
                key={t.value}
                onClick={() => setTier(t.value)}
                className={`py-2.5 px-3 rounded-lg border text-sm transition-colors text-left ${
                  tier === t.value
                    ? 'border-indigo-500 bg-indigo-900/30 text-indigo-300'
                    : 'border-gray-700 text-gray-400 hover:border-gray-600'
                }`}
              >
                <div className="font-medium">{t.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{t.sub}</div>
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-[#DEDAD2] font-medium rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Add contact'}
        </button>
      </div>
    </div>
  )
}
