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
  const slots = [];
  const baseDate = new Date(config.startDate);
  const now = new Date(); // To filter out past slots if baseDate is today

  // Reset baseDate time to 00:00:00 for clean day iteration if it's a future date, 
  // BUT if startDate is *today*, we might want to respect current time? 
  // Actually, usually "startDate" implies the day. 
  baseDate.setHours(0, 0, 0, 0);
  // If admin chose a past date, effectively it starts today.
  // If admin chose a future date, it starts then.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const effectiveStartDate = baseDate.getTime() < todayStart.getTime() ? todayStart : baseDate;
  effectiveStartDate.setHours(0, 0, 0, 0);

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
      // For today, only show future time slots (+buffer?)
      // Simple interaction: if currentDate is today, check if slot > now
      if (currentDate.toDateString() === now.toDateString()) {
        if (currentSlotTime > now) {
          slotLabels.push(currentSlotTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));
        }
      } else {
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

