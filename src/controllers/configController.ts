import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import CheckoutField from '../models/CheckoutField';
import AppConfig from '../models/AppConfig';
import { AdminRequest } from '../middleware/adminAuth';

// @desc    Get app configuration (public endpoint)
// @route   GET /api/config
// @access  Public
// @note    This is a generic config endpoint. checkoutFields is one of the keys.
//          More keys can be added in the future for other app configurations.
export const getAppConfig = asyncHandler(async (_req: Request, res: Response) => {
  // Get only active checkout fields, sorted by order
  const checkoutFields = await CheckoutField.find({ isActive: true })
    .sort({ order: 1 })
    .select('fieldName fieldDisplayName chargeType value order');

  // Transform _id to id for frontend
  const transformedFields = checkoutFields.map(field => ({
    ...field.toObject(),
    id: field._id.toString()
  }));

  // Get AppConfig (singleton)
  const appConfig = await AppConfig.findOne();

  // Generic config response structure - can be extended with more keys in the future
  res.status(200).json({
    success: true,
    data: {
      checkoutFields: transformedFields,
      // Add bookingStartDate
      bookingStartDate: appConfig?.bookingStartDate || null,
      latestVersion: appConfig?.latestVersion || 1,
      minSupportedVersion: appConfig?.minSupportedVersion || 1
      // Future keys can be added here
    }
  });
});

// @desc    Update app configuration (Admin)
// @route   PUT /api/admin/config
// @access  Private/Admin
export const updateAppConfig = asyncHandler(async (req: AdminRequest, res: Response) => {
  const { bookingStartDate, dayStartTime, dayEndTime, slotDuration, bookingWindowDays, latestVersion, minSupportedVersion } = req.body;

  let appConfig = await AppConfig.findOne();

  if (!appConfig) {
    appConfig = new AppConfig();
  }

  if (bookingStartDate !== undefined) {
    appConfig.bookingStartDate = bookingStartDate ? new Date(bookingStartDate) : undefined;
  }
  if (dayStartTime !== undefined) appConfig.dayStartTime = dayStartTime;
  if (dayEndTime !== undefined) appConfig.dayEndTime = dayEndTime;
  if (slotDuration !== undefined) appConfig.slotDuration = slotDuration;
  if (bookingWindowDays !== undefined) appConfig.bookingWindowDays = bookingWindowDays;
  if (latestVersion !== undefined) appConfig.latestVersion = latestVersion;
  if (minSupportedVersion !== undefined) appConfig.minSupportedVersion = minSupportedVersion;

  await appConfig.save();

  res.status(200).json({
    success: true,
    data: appConfig
  });
});

// @desc    Get Available Booking Slots
// @route   GET /api/booking/slots
// @access  Public
export const getBookingSlots = asyncHandler(async (_req: Request, res: Response) => {
  // 1. Fetch Config
  const appConfig = await AppConfig.findOne();
  const config = {
    startDate: appConfig?.bookingStartDate || new Date(),
    startTime: appConfig?.dayStartTime || "09:00",
    endTime: appConfig?.dayEndTime || "17:00",
    slotDuration: appConfig?.slotDuration || 60,
    bookingWindowDays: appConfig?.bookingWindowDays || 7
  };

  // 2. Logic to generate slots
  // 2. Logic to generate slots
  const slots = [];

  // Helper to get time in IST
  const getISTTime = (date: Date = new Date()) => {
    return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  };

  const now = new Date(); // Server time
  const nowIST = getISTTime(now); // Current time in IST

  // const baseDate = new Date(config.startDate);
  // We assume config.startDate is provided in a way that aligns with IST or we treat it as such?
  // If baseDate is just a date string "2024-01-01", 'new Date' creates it in UTC usually.
  // Let's create `effectiveStartDate` relative to IST "Today"
  const todayIST = new Date(nowIST);
  todayIST.setHours(0, 0, 0, 0);

  // If config.startDate is "older" than today, start from today
  // We need to compare just dates.
  // Making baseDate relative to IST?
  // Let's just iterate from 0 to bookingWindowDays relative to "Today IST".
  // And if config.startDate is in future, we skip until then? 
  // For simplicity, assuming startDate is usually "active from now".
  const effectiveStartDate = todayIST; // Simpler assumption for "Active" slots

  for (let i = 0; i < config.bookingWindowDays; i++) {
    const currentDate = new Date(effectiveStartDate);
    currentDate.setDate(effectiveStartDate.getDate() + i);

    // Parse start/end times
    const [startHour, startMin] = config.startTime.split(':').map(Number);
    const [endHour, endMin] = config.endTime.split(':').map(Number);

    const slotLabels: string[] = [];
    const currentSlotTime = new Date(currentDate);
    currentSlotTime.setHours(startHour, startMin, 0, 0);

    const endTimeDate = new Date(currentDate);
    endTimeDate.setHours(endHour, endMin, 0, 0);

    while (currentSlotTime < endTimeDate) {
      // Logic:
      // If currentDate is same day as nowIST...
      // Check if currentSlotTime (which is set to 09:00 on that day) is > nowIST

      // We need to compare timestamps. 
      // currentSlotTime is created from currentDate (which is based on todayIST).
      // So currentSlotTime is in the same "reference frame" (shifted local time represented as Date objects).
      // e.g. todayIST is "2024-01-02 00:00:00" (the object values reflect 2nd Jan).
      // currentSlotTime becomes "2024-01-02 09:00:00".
      // nowIST is "2024-01-02 14:00:00".
      // 09:00 < 14:00.

      // Also add a buffer, e.g. 60 mins
      const bufferMs = 60 * 60 * 1000;

      // Use numeric comparison
      if (currentSlotTime.getTime() > nowIST.getTime() + bufferMs) {
        slotLabels.push(currentSlotTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));
      } else if (currentSlotTime.getDate() !== nowIST.getDate()) {
        // Future dates: always add (since we loop from today forward)
        // Actually, "currentDate" loop covers this.
        // If i > 0, it is a future date.
        // Wait, currentSlotTime is constructed from currentDate.
        // If i=1 (tomorrow), currentSlotTime > nowIST is definitively true.
        // But we need to make sure we don't filter out 9am tomorrow just because 9am < 14pm today?
        // No, getTime() handles full timestamp.
        slotLabels.push(currentSlotTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));
      }

      // Increment
      currentSlotTime.setMinutes(currentSlotTime.getMinutes() + config.slotDuration);
    }

    if (slotLabels.length > 0) {
      const isToday = currentDate.toDateString() === now.toDateString();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = currentDate.toDateString() === tomorrow.toDateString();

      slots.push({
        date: currentDate.toISOString(), // Full ISO string
        dateNum: currentDate.getDate(),
        dayName: isToday ? 'Today' : isTomorrow ? 'Tomorrow' : currentDate.toLocaleDateString('en-US', { weekday: 'short' }),
        fullDate: currentDate.toLocaleDateString('en-GB'), // DD/MM/YYYY
        slots: slotLabels
      });
    }
  }

  res.status(200).json({
    success: true,
    data: slots
  });
});

