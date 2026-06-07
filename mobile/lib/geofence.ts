import { supabase } from './supabase'

export const GEOFENCE_TASK = 'lifeos-geofence'

export type AppMode = 'home' | 'work' | 'car' | 'gym' | 'default'

function registerGeofenceTask() {
  const TaskManager = require('expo-task-manager')
  const Location = require('expo-location')

  TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }: any) => {
    if (error) return
    const { eventType, region } = data
    const entered = eventType === Location.GeofencingEventType.Enter
    if (!entered) return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: anchor } = await supabase
      .from('location_anchors')
      .select('mode')
      .eq('id', region.identifier)
      .single()

    if (!anchor) return

    await supabase.from('mode_history').insert({
      user_id: user.id,
      mode: anchor.mode,
      trigger: 'geofence',
    })
  })
}

export async function startGeofencing(anchors: { id: string; latitude: number; longitude: number; radius_meters: number }[]) {
  const Location = require('expo-location')
  const { status } = await Location.requestBackgroundPermissionsAsync()
  if (status !== 'granted') return false

  registerGeofenceTask()

  const regions = anchors.map((a: any) => ({
    identifier: a.id,
    latitude: a.latitude,
    longitude: a.longitude,
    radius: a.radius_meters,
    notifyOnEnter: true,
    notifyOnExit: false,
  }))

  await Location.startGeofencingAsync(GEOFENCE_TASK, regions)
  return true
}

export async function stopGeofencing() {
  const Location = require('expo-location')
  await Location.stopGeofencingAsync(GEOFENCE_TASK)
}
