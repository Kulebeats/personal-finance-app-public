import React, { useEffect } from "react";
import { useFormContext, Controller } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormField } from "@/features/settings/components/FormField";
import { CountrySelector } from "@/components/CountrySelector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronsUpDown, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchCities, capitalizeCityName } from "@/data/cities";
import { getCountryMetadata } from "@/utils/countryMetadata";

import { UpdateProfileData } from "@/hooks/use-settings";

// Simple mapping for Zambian provinces
const ZAMBIAN_PROVINCES: Record<string, string> = {
  Lusaka: "Lusaka",
  Kitwe: "Copperbelt",
  Ndola: "Copperbelt",
  Chingola: "Copperbelt",
  Mufulira: "Copperbelt",
  Luanshya: "Copperbelt",
  Kabwe: "Central",
  Livingstone: "Southern",
  Kasama: "Northern",
  Chipata: "Eastern",
  Solwezi: "North-Western",
  Mongu: "Western",
  Mansa: "Luapula",
  Chinsali: "Muchinga",
};

export function AddressFields() {
  const {
    control,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<UpdateProfileData>();
  const [openCity, setOpenCity] = React.useState(false);
  const [citySearch, setCitySearch] = React.useState("");

  const selectedCity = watch("address.city");
  const selectedCountry = watch("address.country") || "ZM";

  // Get country-specific metadata for labels
  const countryMeta = getCountryMetadata(selectedCountry);

  // Auto-fill logic
  useEffect(() => {
    if (selectedCity) {
      const normalizedCity = capitalizeCityName(selectedCity);

      // Check if it's a known Zambian city (only if country is ZM)
      if (selectedCountry === "ZM" && ZAMBIAN_PROVINCES[normalizedCity]) {
        setValue("address.state", ZAMBIAN_PROVINCES[normalizedCity]);
      }

      // Check if it's a known international city from our CITIES data
      const cityData = searchCities(selectedCity).find(
        (c) => c.name === normalizedCity,
      );
      if (cityData) {
        // Auto-set country based on city (if not manually changed)
        setValue("address.country", cityData.countryCode);
      }
    }
  }, [selectedCity, setValue, selectedCountry]);

  const filteredCities = searchCities(citySearch);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pb-2 mb-2 border-b border-white/20">
        <MapPin className="w-4 h-4 text-rose-500" />
        <h4 className="text-sm font-semibold text-foreground">Address</h4>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* Address Line 1 - Full Width */}
        <Controller
          name="address.addressLine1"
          control={control}
          render={({ field }) => (
            <FormField
              label="Address Line 1"
              htmlFor="addressLine1"
              required
              error={errors.address?.addressLine1?.message}
            >
              <Input
                {...field}
                value={field.value || ""}
                placeholder="123 Main Street"
                className="input-glass focus:ring-rose-200 transition-all duration-200 focus:scale-[1.01] focus:shadow-md"
              />
            </FormField>
          )}
        />

        {/* Address Line 2 - Full Width */}
        <Controller
          name="address.addressLine2"
          control={control}
          render={({ field }) => (
            <FormField
              label="Address Line 2"
              htmlFor="addressLine2"
              hint="Apartment, suite, unit, building, floor, etc."
            >
              <Input
                {...field}
                value={field.value || ""}
                placeholder="Apt 4B, Floor 3"
                className="input-glass focus:ring-rose-200 transition-all duration-200 focus:scale-[1.01] focus:shadow-md"
              />
            </FormField>
          )}
        />

        {/* City and State/Province - Two Columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* City */}
          <Controller
            name="address.city"
            control={control}
            render={({ field }) => (
              <div className="space-y-1.5 flex flex-col">
                <Label className="text-xs font-semibold text-muted-foreground uppercase">
                  City <span className="text-red-500">*</span>
                </Label>
                <Popover open={openCity} onOpenChange={setOpenCity}>
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        "flex h-10 w-full items-center justify-between rounded-md border border-input input-glass px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 hover:bg-muted",
                        !field.value && "text-muted-foreground",
                      )}
                    >
                      {field.value
                        ? capitalizeCityName(field.value)
                        : "Select city..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[200px] p-0">
                    <Command>
                      <CommandInput
                        placeholder="Search city..."
                        onValueChange={setCitySearch}
                      />
                      <CommandEmpty>No city found.</CommandEmpty>
                      <CommandGroup className="max-h-[200px] overflow-auto">
                        {filteredCities.map((city) => (
                          <CommandItem
                            key={`${city.name}-${city.countryCode}`}
                            value={city.name}
                            onSelect={() => {
                              field.onChange(city.name);
                              setOpenCity(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                field.value === city.name
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            <div className="flex flex-col">
                              <span>{city.name}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {city.country}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </Command>
                  </PopoverContent>
                </Popover>
                {errors.address?.city && (
                  <p className="text-xs text-red-500">
                    {errors.address.city.message}
                  </p>
                )}
              </div>
            )}
          />

          {/* State/Province/Region - Dynamic Dropdown */}
          <Controller
            name="address.state"
            control={control}
            render={({ field }) => (
              <div className="space-y-1.5 flex flex-col">
                <Label className="text-xs font-semibold text-muted-foreground uppercase">
                  {countryMeta.stateLabel}
                </Label>
                {countryMeta.states && countryMeta.states.length > 0 ? (
                  <Select
                    value={field.value || ""}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger className="input-glass focus:ring-rose-200 transition-all duration-200">
                      <SelectValue
                        placeholder={`Select ${countryMeta.stateLabel.toLowerCase()}...`}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {countryMeta.states.map((state) => (
                        <SelectItem key={state} value={state}>
                          {state}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    {...field}
                    value={field.value || ""}
                    placeholder={`Enter ${countryMeta.stateLabel.toLowerCase()}...`}
                    className="input-glass focus:ring-rose-200 transition-all duration-200 focus:scale-[1.01] focus:shadow-md"
                  />
                )}
              </div>
            )}
          />
        </div>

        {/* Postal Code and Country - Two Columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Postal Code - Dynamic Label */}
          <Controller
            name="address.postalCode"
            control={control}
            render={({ field }) => (
              <FormField
                label={countryMeta.postalCodeLabel}
                htmlFor="postalCode"
                required={countryMeta.postalCodeRequired}
              >
                <Input
                  {...field}
                  value={field.value || ""}
                  placeholder={
                    countryMeta.postalCodeLabel === "ZIP Code"
                      ? "10001"
                      : countryMeta.postalCodeLabel === "Postcode"
                        ? "SW1A 2AA"
                        : "10101"
                  }
                  className="input-glass focus:ring-rose-200 transition-all duration-200 focus:scale-[1.01] focus:shadow-md"
                />
              </FormField>
            )}
          />

          {/* Country Selector */}
          <Controller
            name="address.country"
            control={control}
            render={({ field }) => (
              <div className="space-y-1.5 flex flex-col">
                <Label className="text-xs font-semibold text-muted-foreground uppercase">
                  Country <span className="text-red-500">*</span>
                </Label>
                <CountrySelector
                  value={field.value || "ZM"}
                  onChange={field.onChange}
                  className="w-full"
                />
                {errors.address?.country && (
                  <p className="text-xs text-red-500">
                    {errors.address.country.message}
                  </p>
                )}
              </div>
            )}
          />
        </div>
      </div>
    </div>
  );
}
