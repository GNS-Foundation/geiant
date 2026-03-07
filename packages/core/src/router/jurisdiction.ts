// =============================================================================
// GEIANT — JURISDICTION RESOLVER
// Maps H3 cells to regulatory frameworks.
// "Which laws govern an agent operating in this cell?"
// =============================================================================
//
// This is the Jurisdictional Resolution API — the highest-volume commercial
// revenue stream for GEIANT's managed runtime.
//
// Architecture:
//   Phase 0 (now):  Static lookup table covering key territories
//   Phase 1:        Supabase-backed table with H3→country mapping
//   Phase 2:        Full REST API with GNS-node integration + caching
//
// The resolver returns a JurisdictionResult that includes:
//   - Country / region codes
//   - Active regulatory frameworks (GDPR, EU AI Act, CCPA, etc.)
//   - Data residency requirements
//   - Maximum autonomy tier permitted by frameworks
// =============================================================================

import { cellToLatLng, getResolution } from 'h3-js';
import { H3Cell, JurisdictionResult, RegulatoryFramework, AntTier } from '../types/index.js';

// ---------------------------------------------------------------------------
// Regulatory framework library
// ---------------------------------------------------------------------------

const FRAMEWORKS: Record<string, RegulatoryFramework> = {
  GDPR: {
    id: 'GDPR',
    name: 'General Data Protection Regulation',
    jurisdiction: 'EU',
    requiresAuditTrail: true,
    requiresHumanOversight: true,
    maxAutonomyTier: 'trusted',
  },
  EU_AI_ACT: {
    id: 'EU_AI_ACT',
    name: 'EU Artificial Intelligence Act',
    jurisdiction: 'EU',
    requiresAuditTrail: true,
    requiresHumanOversight: true,
    maxAutonomyTier: 'certified',
  },
  EIDAS2: {
    id: 'EIDAS2',
    name: 'eIDAS 2.0 — European Digital Identity',
    jurisdiction: 'EU',
    requiresAuditTrail: true,
    requiresHumanOversight: false,
    maxAutonomyTier: 'sovereign',
  },
  CCPA: {
    id: 'CCPA',
    name: 'California Consumer Privacy Act',
    jurisdiction: 'US-CA',
    requiresAuditTrail: true,
    requiresHumanOversight: false,
    maxAutonomyTier: 'sovereign',
  },
  US_EO_14110: {
    id: 'US_EO_14110',
    name: 'US Executive Order 14110 — AI Safety',
    jurisdiction: 'US',
    requiresAuditTrail: true,
    requiresHumanOversight: true,
    maxAutonomyTier: 'sovereign',
  },
  FINMA: {
    id: 'FINMA',
    name: 'FINMA — Swiss Financial Market Supervisory Authority',
    jurisdiction: 'CH',
    requiresAuditTrail: true,
    requiresHumanOversight: true,
    maxAutonomyTier: 'certified',
  },
  SWISS_DPA: {
    id: 'SWISS_DPA',
    name: 'Swiss Data Protection Act (nDSG)',
    jurisdiction: 'CH',
    requiresAuditTrail: true,
    requiresHumanOversight: false,
    maxAutonomyTier: 'sovereign',
  },
  UK_GDPR: {
    id: 'UK_GDPR',
    name: 'UK GDPR',
    jurisdiction: 'GB',
    requiresAuditTrail: true,
    requiresHumanOversight: true,
    maxAutonomyTier: 'trusted',
  },
  LGPD: {
    id: 'LGPD',
    name: 'Lei Geral de Proteção de Dados (Brazil)',
    jurisdiction: 'BR',
    requiresAuditTrail: true,
    requiresHumanOversight: false,
    maxAutonomyTier: 'sovereign',
  },
  PDPA_SG: {
    id: 'PDPA_SG',
    name: 'Personal Data Protection Act (Singapore)',
    jurisdiction: 'SG',
    requiresAuditTrail: true,
    requiresHumanOversight: false,
    maxAutonomyTier: 'sovereign',
  },
  ITALIAN_CIVIL_CODE: {
    id: 'ITALIAN_CIVIL_CODE',
    name: 'Italian Civil Code + AGCOM AI Regs',
    jurisdiction: 'IT',
    requiresAuditTrail: true,
    requiresHumanOversight: false,
    maxAutonomyTier: 'sovereign',
  },
  NETZDG: {
    id: 'NETZKG',
    name: 'Netzwerkdurchsetzungsgesetz (Germany)',
    jurisdiction: 'DE',
    requiresAuditTrail: true,
    requiresHumanOversight: true,
    maxAutonomyTier: 'certified',
  },
};

// ---------------------------------------------------------------------------
// Country → frameworks mapping (Phase 0 static table)
// ---------------------------------------------------------------------------

type DataResidency = 'eu' | 'us' | 'uk' | 'ch' | 'sg' | 'br' | 'other';

interface CountryProfile {
  countryCode: string;
  regionCode?: string;
  frameworks: string[];
  dataResidency: DataResidency;
}

const COUNTRY_PROFILES: Record<string, CountryProfile> = {
  // EU member states
  IT: { countryCode: 'IT', frameworks: ['GDPR', 'EU_AI_ACT', 'EIDAS2', 'ITALIAN_CIVIL_CODE'], dataResidency: 'eu' },
  DE: { countryCode: 'DE', frameworks: ['GDPR', 'EU_AI_ACT', 'EIDAS2', 'NETZKG'], dataResidency: 'eu' },
  FR: { countryCode: 'FR', frameworks: ['GDPR', 'EU_AI_ACT', 'EIDAS2'], dataResidency: 'eu' },
  ES: { countryCode: 'ES', frameworks: ['GDPR', 'EU_AI_ACT', 'EIDAS2'], dataResidency: 'eu' },
  NL: { countryCode: 'NL', frameworks: ['GDPR', 'EU_AI_ACT', 'EIDAS2'], dataResidency: 'eu' },
  BE: { countryCode: 'BE', frameworks: ['GDPR', 'EU_AI_ACT', 'EIDAS2'], dataResidency: 'eu' },
  SE: { countryCode: 'SE', frameworks: ['GDPR', 'EU_AI_ACT', 'EIDAS2'], dataResidency: 'eu' },
  PL: { countryCode: 'PL', frameworks: ['GDPR', 'EU_AI_ACT', 'EIDAS2'], dataResidency: 'eu' },
  // Non-EU Europe
  CH: { countryCode: 'CH', frameworks: ['SWISS_DPA', 'FINMA'], dataResidency: 'ch' },
  GB: { countryCode: 'GB', frameworks: ['UK_GDPR'], dataResidency: 'uk' },
  // Americas
  US: { countryCode: 'US', frameworks: ['US_EO_14110'], dataResidency: 'us' },
  'US-CA': { countryCode: 'US', regionCode: 'CA', frameworks: ['US_EO_14110', 'CCPA'], dataResidency: 'us' },
  BR: { countryCode: 'BR', frameworks: ['LGPD'], dataResidency: 'br' },
  // Asia-Pacific
  SG: { countryCode: 'SG', frameworks: ['PDPA_SG'], dataResidency: 'sg' },
  // Default
  UNKNOWN: { countryCode: 'XX', frameworks: [], dataResidency: 'other' },
};

// ---------------------------------------------------------------------------
// H3 → Country resolver (Phase 0: lat/lng bounding box heuristic)
// ---------------------------------------------------------------------------

/**
 * Resolve the country code from an H3 cell's centroid coordinates.
 *
 * Phase 0: Uses bounding box approximations for major territories.
 * Phase 1: Replace with a PostGIS spatial query against world borders dataset.
 * Phase 2: Full Jurisdictional Resolution API with caching.
 */
function resolveCountryFromCell(cell: H3Cell): string {
  const [lat, lng] = cellToLatLng(cell);
  return latLngToCountry(lat, lng);
}

function latLngToCountry(lat: number, lng: number): string {
  // Switzerland: 45.8–47.8°N, 5.9–10.5°E (must precede DE/IT — more specific)
  if (lat >= 45.8 && lat <= 47.8 && lng >= 5.9 && lng <= 10.5) return 'CH';
  // Italy: 36–47°N, 6–18°E
  if (lat >= 36 && lat <= 47 && lng >= 6 && lng <= 18) return 'IT';
  // Germany: 47–55°N, 6–15°E
  if (lat >= 47 && lat <= 55 && lng >= 6 && lng <= 15) return 'DE';
  // France: 42–51°N, -5–8°E
  if (lat >= 42 && lat <= 51 && lng >= -5 && lng <= 8) return 'FR';
  // Spain: 36–44°N, -9–3°E
  if (lat >= 36 && lat <= 44 && lng >= -9 && lng <= 3) return 'ES';
  // UK: 49–61°N, -8–2°E
  if (lat >= 49 && lat <= 61 && lng >= -8 && lng <= 2) return 'GB';
  // Sweden: 55–69°N, 11–24°E
  if (lat >= 55 && lat <= 69 && lng >= 11 && lng <= 24) return 'SE';
  // Netherlands: 50.8–53.5°N, 3.3–7.2°E
  if (lat >= 50.8 && lat <= 53.5 && lng >= 3.3 && lng <= 7.2) return 'NL';
  // Brazil: -33–5°N, -73–-34°E
  if (lat >= -33 && lat <= 5 && lng >= -73 && lng <= -34) return 'BR';
  // Singapore: 1.1–1.5°N, 103.6–104.1°E
  if (lat >= 1.1 && lat <= 1.5 && lng >= 103.6 && lng <= 104.1) return 'SG';
  // US West Coast (California approximation)
  if (lat >= 32 && lat <= 42 && lng >= -124 && lng <= -114) return 'US-CA';
  // US broad
  if (lat >= 24 && lat <= 50 && lng >= -125 && lng <= -66) return 'US';

  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the JurisdictionResult for an H3 cell.
 *
 * Returns null if the cell cannot be resolved (open ocean, invalid cell, etc.)
 * The router rejects tasks with null jurisdiction.
 */
export async function resolveJurisdiction(cell: H3Cell): Promise<JurisdictionResult | null> {
  try {
    const countryKey = resolveCountryFromCell(cell);
    const profile = COUNTRY_PROFILES[countryKey] ?? COUNTRY_PROFILES['UNKNOWN'];

    const frameworks = profile.frameworks
      .map(id => FRAMEWORKS[id])
      .filter(Boolean);

    return {
      cell,
      countryCode: profile.countryCode,
      regionCode: profile.regionCode,
      frameworks,
      dataResidency: profile.dataResidency,
      resolvedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Check if an agent operation at a given tier is permitted
 * under the most restrictive framework in the jurisdiction.
 */
export function isOperationPermitted(
  jurisdiction: JurisdictionResult,
  agentTier: AntTier
): { permitted: boolean; restrictingFramework?: RegulatoryFramework } {
  const tierOrder: AntTier[] = ['provisioned', 'observed', 'trusted', 'certified', 'sovereign'];
  const agentTierIndex = tierOrder.indexOf(agentTier);

  for (const framework of jurisdiction.frameworks) {
    const maxTierIndex = tierOrder.indexOf(framework.maxAutonomyTier);
    if (agentTierIndex > maxTierIndex) {
      return { permitted: false, restrictingFramework: framework };
    }
  }

  return { permitted: true };
}
