import { z } from "zod";

export const displaySchema = z.object({
  theme: z
    .enum(["light", "dark", "light-gray", "system"])
    .default("light-gray"),
  currency: z.string().length(3).default("ZMW"),
  currencyPosition: z.enum(["before", "after"]).default("before"),
  locale: z.string().default("en-US"),
  timezone: z.string().default("Africa/Lusaka"),
  numberFormat: z.enum(["US", "EU"]).default("US"),
  dateFormat: z
    .enum(["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"])
    .default("MM/DD/YYYY"),
  firstDayOfWeek: z.enum(["Sunday", "Monday"]).default("Sunday"),
  viewMode: z.enum(["comfortable", "compact"]).default("comfortable"),
});

export type DisplayFormData = z.infer<typeof displaySchema>;
