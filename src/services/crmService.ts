import axios from 'axios';

// CRM Configuration
const CRM_CONFIG = {
    apiKey: process.env.AUTOMATE_BUSINESS_CRM_API_KEY,
    apiUrl: process.env.AUTOMATE_BUSINESS_API_URL,
    pipelineId: process.env.CRM_PIPELINE_ID,
    defaultAssignedTo: process.env.CRM_DEFAULT_ASSIGNED_TO,
    defaultSource: 'Mobile App Sign Up',
    defaultStage: 'Initial Inquiry'
};

interface CreateLeadParams {
    firstName: string;
    lastName?: string; // Optional, often we only have one name field
    email: string;
    phone: string;
    description?: string;
    companyName?: string;
}

/**
 * Create a new lead in the AutomateBusiness CRM
 */
export const createCRMLead = async (params: CreateLeadParams): Promise<boolean> => {
    try {
        const { firstName, lastName, email, phone, description, companyName } = params;

        const payload = {
            first_name: firstName,
            last_name: lastName || '', // CRM might require this field even if empty
            email: email,
            phone: phone, // Assuming phone comes with country code, if not CRM might need 'country_code'
            description: description || 'New user signed up via mobile app',
            source: CRM_CONFIG.defaultSource,
            title: `${firstName} ${lastName || ''}`.trim(),
            stage: CRM_CONFIG.defaultStage,
            assigned_to: CRM_CONFIG.defaultAssignedTo,
            pipeline: CRM_CONFIG.pipelineId,
            company_name: companyName || 'Individual',
            // country_code: 91 // Optional: If phone doesn't have it. Our app usually stores full E.164
        };

        console.log(`[CRM] Creating lead for ${email}...`);

        const response = await axios.post(`${CRM_CONFIG.apiUrl}/createLead`, payload, {
            headers: {
                'Content-Type': 'application/json',
                'API-Key': CRM_CONFIG.apiKey
            }
        });

        if (response.status === 201 || response.status === 200) {
            console.log(`[CRM] Lead created successfully. ID: ${response.data?.id || 'Unknown'}`);
            return true;
        } else {
            console.error(`[CRM] Failed to create lead. Status: ${response.status}`, response.data);
            return false;
        }

    } catch (error: any) {
        console.error('[CRM] Error creating lead:', error.response?.data || error.message);
        // Non-blocking
        return false;
    }
};
