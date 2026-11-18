import React, { useState } from "react";
import { Check, ChevronsUpDown, Plus, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Comprehensive occupation categories based on US Census/IRS classifications
// with additions relevant to Zambian context
const occupationCategories = [
  {
    category: "Healthcare",
    occupations: [
      { value: "doctor", label: "Doctor / Physician" },
      { value: "nurse", label: "Nurse" },
      { value: "pharmacist", label: "Pharmacist" },
      { value: "dentist", label: "Dentist" },
      { value: "therapist", label: "Therapist" },
      { value: "veterinarian", label: "Veterinarian" },
      { value: "clinical_officer", label: "Clinical Officer" },
      { value: "lab_technician", label: "Lab Technician" },
      { value: "midwife", label: "Midwife" },
      { value: "healthcare_other", label: "Other Healthcare" },
    ],
  },
  {
    category: "Business & Finance",
    occupations: [
      { value: "accountant", label: "Accountant / Auditor" },
      { value: "banker", label: "Banker" },
      { value: "business_owner", label: "Business Owner" },
      { value: "financial_analyst", label: "Financial Analyst" },
      { value: "insurance_agent", label: "Insurance Agent" },
      { value: "manager", label: "Manager" },
      { value: "marketing_professional", label: "Marketing Professional" },
      { value: "sales_representative", label: "Sales Representative" },
      { value: "economist", label: "Economist" },
      { value: "hr_professional", label: "HR Professional" },
      { value: "business_other", label: "Other Business/Finance" },
    ],
  },
  {
    category: "Government & Public Sector",
    occupations: [
      { value: "civil_servant", label: "Civil Servant" },
      {
        value: "monitoring_evaluation_officer",
        label: "Monitoring & Evaluation Officer",
      },
      { value: "policy_analyst", label: "Policy Analyst" },
      { value: "diplomat", label: "Diplomat" },
      { value: "military", label: "Military / Defence" },
      { value: "police_officer", label: "Police Officer" },
      { value: "customs_officer", label: "Customs Officer" },
      { value: "government_other", label: "Other Government" },
    ],
  },
  {
    category: "Education & Research",
    occupations: [
      { value: "teacher", label: "Teacher" },
      { value: "lecturer", label: "Lecturer / Professor" },
      { value: "researcher", label: "Researcher" },
      { value: "librarian", label: "Librarian" },
      { value: "school_administrator", label: "School Administrator" },
      { value: "tutor", label: "Tutor" },
      { value: "education_other", label: "Other Education" },
    ],
  },
  {
    category: "Technology & Engineering",
    occupations: [
      { value: "software_developer", label: "Software Developer" },
      { value: "engineer", label: "Engineer" },
      { value: "it_specialist", label: "IT Specialist" },
      { value: "data_analyst", label: "Data Analyst" },
      { value: "network_administrator", label: "Network Administrator" },
      { value: "architect", label: "Architect" },
      { value: "surveyor", label: "Surveyor" },
      { value: "tech_other", label: "Other Tech/Engineering" },
    ],
  },
  {
    category: "Legal & Consulting",
    occupations: [
      { value: "lawyer", label: "Lawyer / Advocate" },
      { value: "paralegal", label: "Paralegal" },
      { value: "judge", label: "Judge / Magistrate" },
      { value: "consultant", label: "Consultant" },
      { value: "legal_other", label: "Other Legal" },
    ],
  },
  {
    category: "Agriculture & Mining",
    occupations: [
      { value: "farmer", label: "Farmer" },
      { value: "agricultural_officer", label: "Agricultural Officer" },
      { value: "miner", label: "Miner" },
      { value: "mining_engineer", label: "Mining Engineer" },
      { value: "fisherman", label: "Fisherman" },
      { value: "forestry_officer", label: "Forestry Officer" },
      { value: "agriculture_other", label: "Other Agriculture/Mining" },
    ],
  },
  {
    category: "Trades & Services",
    occupations: [
      { value: "electrician", label: "Electrician" },
      { value: "plumber", label: "Plumber" },
      { value: "mechanic", label: "Mechanic" },
      { value: "carpenter", label: "Carpenter" },
      { value: "welder", label: "Welder" },
      { value: "technician", label: "Technician" },
      { value: "driver", label: "Driver" },
      { value: "chef", label: "Chef / Cook" },
      { value: "hairdresser", label: "Hairdresser / Barber" },
      { value: "tailor", label: "Tailor" },
      { value: "trades_other", label: "Other Trades/Services" },
    ],
  },
  {
    category: "Media & Creative",
    occupations: [
      { value: "journalist", label: "Journalist" },
      { value: "graphic_designer", label: "Graphic Designer" },
      { value: "photographer", label: "Photographer" },
      { value: "musician", label: "Musician / Artist" },
      { value: "broadcaster", label: "Broadcaster" },
      { value: "content_creator", label: "Content Creator" },
      { value: "media_other", label: "Other Media/Creative" },
    ],
  },
  {
    category: "NGO & Development",
    occupations: [
      { value: "ngo_worker", label: "NGO Worker" },
      { value: "project_manager", label: "Project Manager" },
      { value: "social_worker", label: "Social Worker" },
      {
        value: "community_development",
        label: "Community Development Officer",
      },
      { value: "humanitarian_worker", label: "Humanitarian Worker" },
      { value: "ngo_other", label: "Other NGO/Development" },
    ],
  },
  {
    category: "Other",
    occupations: [
      { value: "student", label: "Student" },
      { value: "retired", label: "Retired" },
      { value: "homemaker", label: "Homemaker" },
      { value: "entrepreneur", label: "Entrepreneur" },
      { value: "freelancer", label: "Freelancer" },
      { value: "unemployed", label: "Currently Unemployed" },
      { value: "other", label: "Other" },
    ],
  },
];

// Flatten for search
const allOccupations = occupationCategories.flatMap((cat) => cat.occupations);

interface OccupationSelectProps {
  value?: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

export function OccupationSelect({
  value,
  onChange,
  disabled,
}: OccupationSelectProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  // Find the label for the current value (either from predefined or custom)
  const currentLabel = value
    ? allOccupations.find((occupation) => occupation.value === value)?.label ||
      value
    : "Select or enter occupation...";

  const handleSelect = (currentValue: string) => {
    onChange(currentValue);
    setOpen(false);
    setSearchValue("");
  };

  const handleCreate = () => {
    if (searchValue && searchValue.trim().length > 0) {
      onChange(searchValue.trim());
      setOpen(false);
      setSearchValue("");
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className={cn(
                "w-full justify-between input-glass",
                !value && "text-muted-foreground"
              )}
              disabled={disabled}
            >
              {currentLabel}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[--radix-popover-trigger-width] p-0"
            align="start"
          >
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search occupations..."
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandList className="max-h-[300px]">
                <CommandEmpty className="py-2 px-2">
                  {searchValue && searchValue.trim().length > 0 ? (
                    <>
                      <p className="text-sm text-muted-foreground text-center mb-2">
                        "{searchValue}" not found in list
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="w-full"
                        onClick={handleCreate}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add "{searchValue}" as custom occupation
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-2">
                      No occupations found
                    </p>
                  )}
                </CommandEmpty>
                {occupationCategories.map((category) => {
                  // Filter occupations based on search value
                  const filteredOccupations = searchValue
                    ? category.occupations.filter((occ) =>
                        occ.label
                          .toLowerCase()
                          .includes(searchValue.toLowerCase())
                      )
                    : category.occupations;

                  // Only show category if it has matching occupations
                  if (filteredOccupations.length === 0) return null;

                  return (
                    <CommandGroup
                      key={category.category}
                      heading={category.category}
                    >
                      {filteredOccupations.map((occupation) => (
                        <CommandItem
                          key={occupation.value}
                          value={occupation.label}
                          onSelect={(curVal) => {
                            const match = allOccupations.find(
                              (o) =>
                                o.label.toLowerCase() === curVal.toLowerCase()
                            );
                            handleSelect(match ? match.value : curVal);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              value === occupation.value
                                ? "opacity-100"
                                : "opacity-0"
                            )}
                          />
                          {occupation.label}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  );
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label="More information"
              >
                <Info className="h-4 w-4 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[280px]">
              <p className="text-sm">
                Can't find your profession? Type it in the search box and click
                "Add as custom occupation" to enter your specific job title.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
