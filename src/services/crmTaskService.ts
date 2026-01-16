import axios from 'axios';

// CRM Task Configuration
const CRM_TASK_CONFIG = {
    apiKey: process.env.AUTOMATE_BUSINESS_TASK_API_KEY,
    apiUrl: process.env.AUTOMATE_BUSINESS_API_URL || 'https://api.automatebusiness.com/functions/v1',
    categoryId: process.env.CRM_TASK_CATEGORY_ID, // Default to 'Routine' or appropriate category
    defaultPriority: 'High',
    defaultAssignedToId: process.env.CRM_DEFAULT_TASK_ASSIGNEE_ID // Fallback admin ID
};

interface CreateTaskParams {
    title: string;
    description?: string;
    assignedById: string; // The user ID assigning the task (e.g. System Admin or current user)
    assignedToId: string; // The target user's CRM ID
    priority?: string;
    targetDate?: string; // YYYY-MM-DD
}

/**
 * Assign a task in the AutomateBusiness Task App
 */
export const assignCRMTask = async (params: CreateTaskParams): Promise<boolean> => {
    try {
        const { title, description, assignedById, assignedToId, priority, targetDate } = params;

        const payload = {
            title,
            description: description || 'No description provided',
            assigned_by_id: assignedById,
            assigned_to_id: assignedToId,
            category_id: CRM_TASK_CONFIG.categoryId,
            priority: priority || CRM_TASK_CONFIG.defaultPriority,
            target_date: targetDate || new Date().toISOString().split('T')[0] // Default to today
        };

        console.log(`[CRM Task] Assigning task "${title}" to ${assignedToId}...`);

        const response = await axios.post(`${CRM_TASK_CONFIG.apiUrl}/assignTask`, payload, {
            headers: {
                'Content-Type': 'application/json',
                'API-Key': CRM_TASK_CONFIG.apiKey
            }
        });

        if (response.status === 201 || response.status === 200) {
            console.log(`[CRM Task] Task assigned successfully. ID: ${response.data?.id || 'Unknown'}`);
            return true;
        } else {
            console.error(`[CRM Task] Failed to assign task. Status: ${response.status}`, response.data);
            return false;
        }

    } catch (error: any) {
        console.error('[CRM Task] Error assigning task:', error.response?.data || error.message);
        // Non-blocking
        return false;
    }
};
