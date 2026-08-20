const ROLES = Object.freeze({
  CUSTOMER: 'customer',
  SALES: 'sales',
  EDITOR: 'editor',
  ADMIN: 'admin'
});

const STATUS = Object.freeze({
  ACTIVE: 'active',
  DISABLED: 'disabled',
  PENDING: 'pending'
});

const PERMISSIONS = Object.freeze({
  MANAGE_VEHICLES: 'manageVehicles',
  MANAGE_USERS: 'manageUsers',
  MANAGE_PROMOTIONS: 'managePromotions',
  MANAGE_CAMPAIGNS: 'manageCampaigns',
  MANAGE_LEADS: 'manageLeads',
  VIEW_ANALYTICS: 'viewAnalytics'
});

// ⚠️ SINGLE SOURCE OF TRUTH — duplicada a mano en firestore.rules
// (función rolePermissions original; las Rules finales usan la forma
// simplificada canManageVehicles()/canManageUsers(), pero esta matriz
// sigue gobernando la UI: qué botones mostrar por rol).
const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.CUSTOMER]: [],
  [ROLES.SALES]: [PERMISSIONS.VIEW_ANALYTICS, PERMISSIONS.MANAGE_LEADS],
  [ROLES.EDITOR]: [PERMISSIONS.MANAGE_VEHICLES, PERMISSIONS.MANAGE_PROMOTIONS],
  [ROLES.ADMIN]: Object.values(PERMISSIONS)
});

function hasPermission(role, permission) {
  return (ROLE_PERMISSIONS[role] || []).includes(permission);
}
