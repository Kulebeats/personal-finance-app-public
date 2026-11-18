import React, { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface Country {
  code: string;
  name: string;
  dialCode: string;
}

// Helper to get flag URL from country code
function getFlagUrl(
  countryCode: string,
  size: "w20" | "w40" | "w80" = "w40"
): string {
  return `https://flagcdn.com/${size}/${countryCode.toLowerCase()}.png`;
}

// Top countries for quick access
const POPULAR_COUNTRIES: Country[] = [
  { code: "ZM", name: "Zambia", dialCode: "+260" },
  { code: "ZA", name: "South Africa", dialCode: "+27" },
  { code: "KE", name: "Kenya", dialCode: "+254" },
  { code: "TZ", name: "Tanzania", dialCode: "+255" },
  { code: "UG", name: "Uganda", dialCode: "+256" },
  { code: "ZW", name: "Zimbabwe", dialCode: "+263" },
  { code: "MW", name: "Malawi", dialCode: "+265" },
  { code: "BW", name: "Botswana", dialCode: "+267" },
  { code: "US", name: "United States", dialCode: "+1" },
  { code: "GB", name: "United Kingdom", dialCode: "+44" },
];

// All countries (subset for now - can expand)
const ALL_COUNTRIES: Country[] = [
  ...POPULAR_COUNTRIES,
  { code: "AF", name: "Afghanistan", dialCode: "+93" },
  { code: "AL", name: "Albania", dialCode: "+355" },
  { code: "DZ", name: "Algeria", dialCode: "+213" },
  { code: "AR", name: "Argentina", dialCode: "+54" },
  { code: "AU", name: "Australia", dialCode: "+61" },
  { code: "AT", name: "Austria", dialCode: "+43" },
  { code: "BD", name: "Bangladesh", dialCode: "+880" },
  { code: "BE", name: "Belgium", dialCode: "+32" },
  { code: "BR", name: "Brazil", dialCode: "+55" },
  { code: "CA", name: "Canada", dialCode: "+1" },
  { code: "CN", name: "China", dialCode: "+86" },
  { code: "EG", name: "Egypt", dialCode: "+20" },
  { code: "FR", name: "France", dialCode: "+33" },
  { code: "DE", name: "Germany", dialCode: "+49" },
  { code: "GH", name: "Ghana", dialCode: "+233" },
  { code: "IN", name: "India", dialCode: "+91" },
  { code: "ID", name: "Indonesia", dialCode: "+62" },
  { code: "IE", name: "Ireland", dialCode: "+353" },
  { code: "IT", name: "Italy", dialCode: "+39" },
  { code: "JP", name: "Japan", dialCode: "+81" },
  { code: "MX", name: "Mexico", dialCode: "+52" },
  { code: "NL", name: "Netherlands", dialCode: "+31" },
  { code: "NZ", name: "New Zealand", dialCode: "+64" },
  { code: "NG", name: "Nigeria", dialCode: "+234" },
  { code: "PK", name: "Pakistan", dialCode: "+92" },
  { code: "PH", name: "Philippines", dialCode: "+63" },
  { code: "PL", name: "Poland", dialCode: "+48" },
  { code: "PT", name: "Portugal", dialCode: "+351" },
  { code: "RU", name: "Russia", dialCode: "+7" },
  { code: "SA", name: "Saudi Arabia", dialCode: "+966" },
  { code: "SG", name: "Singapore", dialCode: "+65" },
  { code: "ES", name: "Spain", dialCode: "+34" },
  { code: "SE", name: "Sweden", dialCode: "+46" },
  { code: "CH", name: "Switzerland", dialCode: "+41" },
  { code: "TH", name: "Thailand", dialCode: "+66" },
  { code: "TR", name: "Turkey", dialCode: "+90" },
  { code: "AE", name: "United Arab Emirates", dialCode: "+971" },
];

interface CountrySelectorProps {
  value?: string;
  onChange: (countryCode: string) => void;
  className?: string;
}

export function CountrySelector({
  value = "ZM",
  onChange,
  className,
}: CountrySelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const selectedCountry =
    ALL_COUNTRIES.find((c) => c.code === value) || POPULAR_COUNTRIES[0];

  const filteredCountries = searchQuery
    ? ALL_COUNTRIES.filter(
        (country) =>
          country.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          country.dialCode.includes(searchQuery) ||
          country.code.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : ALL_COUNTRIES;

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <div className="flex w-full flex-nowrap items-center gap-3 overflow-hidden">
          <img
            src={getFlagUrl(selectedCountry.code, "w40")}
            alt={selectedCountry.name}
            className="w-5 h-3.5 rounded-sm shrink-0 object-cover shadow-sm"
          />
          <span className="flex-1 text-sm truncate text-left">
            {selectedCountry.name}
          </span>
          <span className="text-xs text-muted-foreground shrink-0">
            {selectedCountry.dialCode}
          </span>
        </div>
      </SelectTrigger>
      <SelectContent className="max-h-[300px]">
        <div className="sticky top-0 z-10 bg-background p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search countries..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
        <div className="p-1">
          {filteredCountries.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No countries found
            </div>
          ) : (
            filteredCountries.map((country) => (
              <SelectItem key={country.code} value={country.code}>
                <div className="flex items-center gap-3">
                  <img
                    src={getFlagUrl(country.code, "w40")}
                    alt={country.name}
                    className="w-5 h-auto rounded-sm"
                  />
                  <span className="flex-1">{country.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {country.dialCode}
                  </span>
                </div>
              </SelectItem>
            ))
          )}
        </div>
      </SelectContent>
    </Select>
  );
}

// Export country data for use in other components
export { ALL_COUNTRIES, POPULAR_COUNTRIES };
export type { Country };
