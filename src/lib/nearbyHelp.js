// What an SOS needs, for Famora Social's nearby helpers. The server derives
// help_kind from the stored English tile label (see _nearby_help_kind in
// supabase/migrations/20260924120000_nearby_help_kind.sql); this mirrors it so
// the family overlay, which reads sos_alerts.message directly, agrees.
//
// The numbers match the SOS tiles in pages/SOSPage.jsx (QUICK_MESSAGES), and
// are never translated.

const KIND_BY_LABEL = {
  'Need Ambulance':   'ambulance',
  'Natural Disaster': 'disaster',
  'Fire Around Me':   'fire',
}

const NUMBER_BY_KIND = { police: '100', ambulance: '108', disaster: '108', fire: '112' }

export const helpKindFromMessage = (label) => KIND_BY_LABEL[label] || 'police'
export const helpNumber = (kind) => NUMBER_BY_KIND[kind] || '100'
