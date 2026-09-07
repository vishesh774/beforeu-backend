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

/**
 * Health ID card, laid out to the approved design.
 *
 * Landscape 1600×950 in the source artwork; rendered here at 900×534 pt (same 1.685 ratio) which
 * is a good compromise between on-screen sharpness and file size. Every position below is that
 * artwork's coordinate scaled by SCALE, so the design can be re-measured against the original.
 *
 * PDFKit can only embed **PNG and JPEG** — not SVG or WebP. Partner logos are uploaded as base64
 * from the dashboard, which restricts the picker to those two for exactly this reason. A logo that
 * fails to decode is skipped rather than failing the whole card.
 */

const ARTWORK_WIDTH = 1600;
const ARTWORK_HEIGHT = 950;
const SCALE = 0.5625; // → 900 × 534 pt

const W = ARTWORK_WIDTH * SCALE;
const H = ARTWORK_HEIGHT * SCALE;

/** Map a coordinate from the artwork's pixel grid to the PDF canvas. */
const s = (artworkPx: number): number => artworkPx * SCALE;

const COLORS = {
    gradientBlue: '#1E78B4',
    gradientPale: '#D3E9EB',
    gradientMint: '#8DCAC5',
    gradientTeal: '#4BA39D',
    heading: '#111827',
    body: '#1F2937',
    white: '#FFFFFF',
    sosYellow: '#FAE616',
    footerBar: '#141A2E',
    footerMuted: '#C3C9D6'
};

/** Pull the raw bytes out of a `data:image/...;base64,...` string. */
const decodeDataUri = (dataUri?: string | null): Buffer | null => {
    if (!dataUri || !dataUri.startsWith('data:image')) {
        return null;
    }
    const base64 = dataUri.split(',')[1];
    if (!base64) {
        return null;
    }
    try {
        return Buffer.from(base64, 'base64');
    } catch {
        return null;
    }
};

const formatValidity = (validity?: Date): string => {
    if (!validity) {
        return '—';
    }
    // DD/MM/YYYY, per the design. Explicitly IST: the process pins no TZ, and a plan expiring just
    // after midnight IST would otherwise print the previous day.
    return new Date(validity).toLocaleDateString('en-GB', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
};

export const generateHealthCardBuffer = async (data: HealthCardData): Promise<Buffer> => {
    const activePartners = await HealthPartner.find({ isActive: true }).sort({ order: 1 }).limit(5);
    const companySettings = (await CompanySettings.findOne()) as any;

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: [W, H], margin: 0 });

            const chunks: Buffer[] = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', err => reject(err));

            // ---------------------------------------------------------------- background
            const backdrop = doc.linearGradient(0, 0, W, H);
            backdrop.stop(0, COLORS.gradientBlue)
                .stop(0.34, COLORS.gradientPale)
                .stop(0.62, COLORS.gradientMint)
                .stop(1, COLORS.gradientTeal);
            doc.rect(0, 0, W, H).fill(backdrop);

            // Faint constellation lines across the upper right, as in the artwork.
            doc.save().opacity(0.18).strokeColor(COLORS.white).lineWidth(0.6);
            const nodes: Array<[number, number]> = [
                [s(960), s(60)], [s(1180), s(160)], [s(1310), s(40)],
                [s(1420), s(215)], [s(1545), s(120)], [s(1250), s(300)]
            ];
            nodes.forEach(([x, y], i) => {
                const next = nodes[(i + 1) % nodes.length];
                doc.moveTo(x, y).lineTo(next[0], next[1]).stroke();
            });
            doc.fillColor(COLORS.white);
            nodes.forEach(([x, y]) => doc.circle(x, y, s(6)).fill());
            doc.restore();

            // Soft brand wash on the right, echoing the swoosh in the artwork.
            //
            // Deliberately drawn rather than stamped from CompanySettings.logoUrl: most uploaded
            // logos are PNGs with a white background, and at this size that renders as a large
            // translucent white rectangle across the teal. A drawn shape always composites cleanly.
            const companyLogo = decodeDataUri(companySettings?.logoUrl);
            doc.save().opacity(0.13);
            doc.circle(s(1300), s(600), s(240)).fill(COLORS.white);
            doc.opacity(0.10);
            doc.circle(s(1455), s(775), s(155)).fill(COLORS.gradientPale);
            doc.opacity(0.08);
            doc.circle(s(1130), s(790), s(115)).fill(COLORS.white);
            doc.restore();

            // ---------------------------------------------------------------- header
            // The header logo should be a PNG with a transparent background — a white-matted logo
            // will show as a box against the blue corner.
            if (companyLogo) {
                try {
                    doc.image(companyLogo, s(90), s(15), { fit: [s(180), s(200)] });
                } catch {
                    doc.font('Helvetica-Bold').fontSize(s(58)).fillColor('#1B4F9C')
                        .text('Before U', s(90), s(95));
                }
            } else {
                doc.font('Helvetica-Bold').fontSize(s(58)).fillColor('#1B4F9C')
                    .text('Before U', s(90), s(95));
            }

            const rightMargin = s(60);
            const rightBlockWidth = W - s(700) - rightMargin;

            doc.font('Helvetica-Bold').fontSize(s(46)).fillColor(COLORS.heading)
                .text('HEALTH ID CARD', s(700), s(28), { width: rightBlockWidth, align: 'right' });

            doc.font('Helvetica-Bold').fontSize(s(30)).fillColor(COLORS.sosYellow)
                .text('One-Tap SOS for Immediate Help.', s(700), s(92), {
                    width: rightBlockWidth,
                    align: 'right'
                });

            // ---------------------------------------------------------------- cardholder
            const fieldX = s(68);

            doc.font('Helvetica-Bold').fontSize(s(34)).fillColor(COLORS.white)
                .text(`NAME : ${(data.name || '—').toUpperCase()}`, fieldX, s(258), {
                    width: s(820),
                    lineBreak: false,
                    ellipsis: true
                });

            doc.font('Helvetica-Bold').fontSize(s(34)).fillColor(COLORS.body)
                .text(`HEALTH ID ${data.uhid || 'PENDING'}`, fieldX, s(330), {
                    width: s(820),
                    lineBreak: false,
                    ellipsis: true
                });

            doc.font('Helvetica-Bold').fontSize(s(34)).fillColor(COLORS.body)
                .text(`VALID TILL: ${formatValidity(data.validity)}`, s(900), s(330), {
                    width: W - s(900) - rightMargin,
                    align: 'left',
                    lineBreak: false
                });

            // The number a hospital should ring — the customer's nominated contact if they set one,
            // otherwise the company's own emergency line.
            const emergencyNumber = data.emergencyContact || companySettings?.phone || '—';
            doc.font('Helvetica-Bold').fontSize(s(34)).fillColor(COLORS.body)
                .text(`EMERGENCY : ${emergencyNumber}`, fieldX, s(418), {
                    width: s(820),
                    lineBreak: false,
                    ellipsis: true
                });

            // ---------------------------------------------------------------- partners
            doc.font('Helvetica-Bold').fontSize(s(30)).fillColor(COLORS.white)
                .text('OUR PARTNERS', fieldX, s(565));

            const bandX = s(45);
            const bandY = s(617);
            const bandW = W - bandX * 2;
            const bandH = s(215);

            doc.save().opacity(0.32);
            doc.rect(bandX, bandY, bandW, bandH).fill(COLORS.white);
            doc.restore();

            // Logo tiles run left to right inside the band.
            const tileW = s(455);
            const tileH = s(95);
            const tileGap = s(30);
            let tileX = bandX + s(30);
            const tileY = bandY + (bandH - tileH) / 2;

            activePartners.forEach(partner => {
                const logo = decodeDataUri(partner.logo);
                if (!logo) {
                    return;
                }
                if (tileX + tileW > bandX + bandW) {
                    return; // Ran out of room — the query already caps at 5.
                }

                try {
                    doc.rect(tileX, tileY, tileW, tileH).fill(COLORS.white);
                    doc.image(logo, tileX + s(12), tileY + s(10), {
                        fit: [tileW - s(24), tileH - s(20)],
                        align: 'center',
                        valign: 'center'
                    });
                    tileX += tileW + tileGap;
                } catch (error) {
                    console.warn(`[HealthCard] Skipping unreadable logo for partner ${partner.name}:`, error);
                }
            });

            // ---------------------------------------------------------------- footer
            const footerH = s(95);
            const footerY = H - footerH;
            doc.rect(0, footerY, W, footerH).fill(COLORS.footerBar);

            const footerTextY = footerY + (footerH - s(26)) / 2;

            doc.font('Helvetica-Bold').fontSize(s(26)).fillColor(COLORS.white)
                .text(companySettings?.name ? `${companySettings.name} Private Limited` : 'BeforeU Care Private Limited',
                    fieldX, footerTextY, { lineBreak: false });

            // Sized and given enough width to stay on one line — it wraps out of the bar otherwise.
            const disclaimerX = s(600);
            doc.font('Helvetica').fontSize(s(21)).fillColor(COLORS.footerMuted)
                .text('Present this card at any network partner. Valid only with an active plan.',
                    disclaimerX, footerTextY + s(3), {
                        width: W - disclaimerX - rightMargin,
                        align: 'right',
                        lineBreak: false
                    });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
};
