// ============================================================
// Δ HELIX v3 — API LAYER (Supabase)
// ============================================================

import { CONFIG } from './config.js';

const headers = {
    'apikey': CONFIG.SUPABASE.KEY,
    'Authorization': `Bearer ${CONFIG.SUPABASE.KEY}`,
    'Content-Type': 'application/json'
};

export const api = {
    // ========== VARIANTS ==========
    
    async getVariants() {
        const res = await fetch(
            `${CONFIG.SUPABASE.URL}/rest/v1/variants?select=*,evidence_links(*)&order=legacy_name.asc`,
            { headers }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    },
    
    async getVariant(id) {
        const res = await fetch(
            `${CONFIG.SUPABASE.URL}/rest/v1/variants?id=eq.${id}&select=*,evidence_links(*)`,
            { headers }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data[0];
    },
    
    async createVariant(data) {
        const res = await fetch(
            `${CONFIG.SUPABASE.URL}/rest/v1/variants`,
            {
                method: 'POST',
                headers: { ...headers, 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    legacy_name: data.legacy_name,
                    protein_name: data.protein_name,
                    cdna_name: data.cdna_name,
                    final_determination: data.final_determination,
                    cftr_class: data.cftr_class || null,
                    class_subtype: data.class_subtype || null,
                    class_confidence: data.class_confidence || null,
                    eti_prediction: data.eti_prediction || null,
                    eti_evidence_level: data.eti_evidence_level || null,
                    eti_recommendation: data.eti_recommendation || null,
                    data_status: 'minimal',
                    validation_count: 0,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
            }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        return result[0];
    },
    
    async updateVariant(id, updates) {
        const res = await fetch(
            `${CONFIG.SUPABASE.URL}/rest/v1/variants?id=eq.${id}`,
            {
                method: 'PATCH',
                headers: { ...headers, 'Prefer': 'return=minimal' },
                body: JSON.stringify({
                    ...updates,
                    updated_at: new Date().toISOString()
                })
            }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return true;
    },
    
    async deleteVariant(id) {
        const res = await fetch(
            `${CONFIG.SUPABASE.URL}/rest/v1/variants?id=eq.${id}`,
            { method: 'DELETE', headers }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return true;
    },
    
    // ========== VALIDATION HISTORY ==========
    
    async addValidation(variantId, data) {
        const res = await fetch(
            `${CONFIG.SUPABASE.URL}/rest/v1/validation_history`,
            {
                method: 'POST',
                headers: { ...headers, 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    variant_id: variantId,
                    clinician_name: data.clinician_name,
                    clinician_role: data.clinician_role,
                    action: 'VALIDATED',
                    notes: data.notes || null,
                    created_at: new Date().toISOString()
                })
            }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        
        // Update variant validation count
        await this.incrementValidationCount(variantId, data.clinician_name, data.clinician_role);
        
        return result[0];
    },
    
    async getValidationHistory(variantId) {
        const res = await fetch(
            `${CONFIG.SUPABASE.URL}/rest/v1/validation_history?variant_id=eq.${variantId}&order=created_at.desc`,
            { headers }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    },
    
    async incrementValidationCount(variantId, validatorName, validatorRole) {
        const variant = await this.getVariant(variantId);
        const newCount = (variant.validation_count || 0) + 1;
        
        await fetch(
            `${CONFIG.SUPABASE.URL}/rest/v1/variants?id=eq.${variantId}`,
            {
                method: 'PATCH',
                headers: { ...headers, 'Prefer': 'return=minimal' },
                body: JSON.stringify({
                    validation_count: newCount,
                    last_validator_name: validatorName,
                    last_validator_role: validatorRole,
                    last_validated_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
            }
        );
    },
    
    // ========== EVIDENCE LINKS ==========
    
    async addEvidenceLink(variantId, data) {
        const res = await fetch(
            `${CONFIG.SUPABASE.URL}/rest/v1/evidence_links`,
            {
                method: 'POST',
                headers: { ...headers, 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    variant_id: variantId,
                    type: data.type,
                    title: data.title,
                    url: data.url,
                    source: data.source || data.type,
                    notes: data.notes || null,
                    date_added: new Date().toISOString()
                })
            }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        return result[0];
    },
    
    async getEvidenceLinks(variantId) {
        const res = await fetch(
            `${CONFIG.SUPABASE.URL}/rest/v1/evidence_links?variant_id=eq.${variantId}`,
            { headers }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    },
    
    // ========== UTILITIES ==========
    
    async loadExistingRoles() {
        const res = await fetch(
            `${CONFIG.SUPABASE.URL}/rest/v1/validation_history?select=clinician_role&order=created_at.desc`,
            { headers }
        );
        if (!res.ok) return [];
        const data = await res.json();
        const roleCounts = new Map();
        data.forEach(h => {
            if (h.clinician_role) {
                roleCounts.set(h.clinician_role, (roleCounts.get(h.clinician_role) || 0) + 1);
            }
        });
        return Array.from(roleCounts.entries())
            .map(([role, count]) => ({ role_name: role, usage_count: count }))
            .sort((a, b) => b.usage_count - a.usage_count)
            .slice(0, 20);
    }
};
