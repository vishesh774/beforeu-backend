import Service from '../models/Service';
import ServiceVariant from '../models/ServiceVariant';

export const getOrCreateSystemService = async (
    id: string,
    name: string,
    icon: string,
    variantId: string,
    variantName: string,
    variantDescription: string
) => {
    let service = await Service.findOne({ id });

    if (!service) {
        service = await Service.create({
            id,
            name,
            icon,
            description: `System defined ${name} service`,
            isActive: true,
            serviceRegions: [],
            tags: ['system']
        });
    }

    let variant = await ServiceVariant.findOne({ serviceId: service._id, id: variantId });

    if (!variant) {
        variant = await ServiceVariant.create({
            serviceId: service._id,
            id: variantId,
            name: variantName,
            description: variantDescription,
            originalPrice: 0,
            finalPrice: 0,
            estimatedTimeMinutes: 60,
            includedInSubscription: false,
            creditValue: 0,
            serviceType: 'In-Person',
            availableForPurchase: false,
            isActive: true,
            customerVisitRequired: true
        });
    }

    return { service, variant };
};

export const getSOSService = () => getOrCreateSystemService(
    'sos',
    'SOS Emergency',
    'AlertTriangle',
    'sos-standard',
    'SOS Alert',
    'Emergency SOS Alert triggered by user'
);

export const getPlanPurchaseService = () => getOrCreateSystemService(
    'plan-purchase',
    'Plan Purchase',
    'Shield',
    'plan-standard',
    'Plan Activation',
    'Purchase and activation of service plan'
);
