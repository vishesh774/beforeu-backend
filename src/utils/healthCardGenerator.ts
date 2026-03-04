import PDFDocument from 'pdfkit';
import HealthPartner from '../models/HealthPartner';
import CompanySettings from '../models/CompanySettings';

export interface HealthCardData {
    name: string;
    phone: string;
    gender?: string;
    dob?: Date;
    uhid?: string;
    emergencyContact?: string;
    validity?: Date;
}

export const generateHealthCardBuffer = async (data: HealthCardData): Promise<Buffer> => {
    const activePartners = await HealthPartner.find({ isActive: true }).sort({ order: 1 }).limit(6);
    const companySettings = (await CompanySettings.findOne()) || {
        name: "BeforeU",
        logoUrl: ""
    };

    return new Promise((resolve, reject) => {
        try {
            // Credit card size: 3.375 x 2.125 inches
            // At 72 DPI: 243 x 153 points
            // We'll multiply by 2 for better print quality on larger view: 486 x 306
            const doc = new PDFDocument({
                size: [486, 306],
                margin: 0
            });

            const chunks: Buffer[] = [];
            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', (err) => reject(err));

            // Colors
            const brandPurple = '#7c3aed';
            const textBlack = '#1e293b';
            const textGray = '#64748b';
            const white = '#ffffff';

            // --- FRONT SIDE ---

            // Background Gradient Rect (Top bar)
            doc.rect(0, 0, 486, 80).fill(brandPurple);

            // App Logo / Name
            const settings = companySettings as any;
            if (settings.logoUrl && settings.logoUrl.startsWith('data:image')) {
                try {
                    const base64Data = settings.logoUrl.split(',')[1];
                    const logoBuffer = Buffer.from(base64Data, 'base64');
                    doc.image(logoBuffer, 20, 20, { fit: [80, 40] });
                } catch {
                    doc.font('Helvetica-Bold').fontSize(24).fillColor(white).text(settings.name, 25, 25);
                }
            } else {
                doc.font('Helvetica-Bold').fontSize(24).fillColor(white).text(settings.name || 'BeforeU', 25, 25);
            }

            // "HEALTH ID" Label
            doc.font('Helvetica-Bold').fontSize(14).fillColor(white).text('DIGITAL HEALTH ID', 250, 25, { align: 'right', width: 210 });
            doc.font('Helvetica').fontSize(8).fillColor('rgba(255,255,255,0.8)').text('One-Tap SOS for Immediate Help.', 250, 45, { align: 'right', width: 210 });

            // User Info Section
            const contentY = 100;
            const labelX = 25;
            const valueOffset = 100;

            const drawField = (label: string, value: string, y: number) => {
                doc.font('Helvetica-Bold').fontSize(9).fillColor(textGray).text(label.toUpperCase(), labelX, y);
                doc.font('Helvetica-Bold').fontSize(11).fillColor(textBlack).text(value || 'N/A', labelX + valueOffset, y);
            };

            drawField('Name', data.name, contentY);
            // drawField('Gender/Age', `${data.gender || '-'}${data.dob ? ' / ' + calculateAge(data.dob) : ''}`, contentY + 25);
            drawField('Health ID', data.uhid || 'PENDING', contentY + 25);
            drawField('Emergency', data.emergencyContact || 'N/A', contentY + 50);

            // Expiry / Validity
            const validityStr = data.validity ? new Date(data.validity).toLocaleDateString('en-GB') : 'PERMANENT';
            doc.font('Helvetica').fontSize(8).fillColor(textGray).text('VALID TILL:', 340, contentY + 75);
            doc.font('Helvetica-Bold').fontSize(9).fillColor(textBlack).text(validityStr, 400, contentY + 75);

            // --- Partners Section (Bottom) ---
            doc.rect(0, 220, 486, 86).fill('#f8fafc');
            doc.font('Helvetica-Bold').fontSize(7).fillColor(textGray).text('OUR PARTNERS', 25, 230);

            // Draw partner logos
            let logoX = 25;
            activePartners.forEach((partner) => {
                if (partner.logo && partner.logo.startsWith('data:image')) {
                    try {
                        const base64Data = partner.logo.split(',')[1];
                        const pLogoBuffer = Buffer.from(base64Data, 'base64');
                        doc.image(pLogoBuffer, logoX, 245, { fit: [60, 35] });
                        logoX += 75;
                    } catch (e) {
                        console.log(e);
                        // skip failed images
                    }
                }
            });

            // Decorator dot/circle
            // doc.circle(460, 280, 15).fill(brandPurple);
            // doc.font('Helvetica-Bold').fontSize(12).fillColor(white).text('+', 456, 273);

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
};

// function calculateAge(dob: Date): number {
//     const diff = Date.now() - new Date(dob).getTime();
//     const ageDate = new Date(diff);
//     return Math.abs(ageDate.getUTCFullYear() - 1970);
// }
