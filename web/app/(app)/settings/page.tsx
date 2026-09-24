import { SettingsForm } from '@/components/SettingsForm'

export default function SettingsPage() {
  return (
    <div className="p-4 sm:p-8 max-w-2xl">
      <h2 className="text-xl font-bold text-white mb-6">Settings</h2>
      <SettingsForm />
    </div>
  )
}
