import { useImportWizard } from "../ImportWizardContext";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export function ColumnAssignmentStep() {
  const { parsedData, mapping, updateMapping, setStep, currentStep } =
    useImportWizard();

  // If we have parsed headers, let's use them
  const headers = parsedData?.headers || [];

  const requiredFields = [
    { label: "Date", key: "date", required: true },
    { label: "Amount", key: "amount", required: true },
    { label: "Merchant Name", key: "merchant", required: false }, // Optional but good
  ];

  const optionalFields = [
    { label: "Category", key: "category" },
    { label: "Account", key: "account" },
    { label: "Notes", key: "notes" },
    // { label: "Tags", key: "tags" },
  ];

  const handleNext = () => {
    // Basic validation
    if (!mapping.date || !mapping.amount) {
      alert("Please map Date and Amount fields");
      return;
    }
    setStep("category-mapping");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b">
        <h2 className="text-xl font-semibold">
          Assign the columns in your file to fields in CopperCoin
        </h2>
        <p className="text-muted-foreground text-sm">
          Choose from the drop down list of your CSV columns and map each to the
          appropriate field in CopperCoin.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Required Section */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Required
          </h3>
          <div className="space-y-4">
            {requiredFields.map((field) => (
              <div
                key={field.key}
                className="grid grid-cols-2 gap-8 items-center"
              >
                <div className="font-medium text-sm">{field.label}</div>
                <Select
                  value={mapping[field.key as keyof typeof mapping]}
                  onValueChange={(val) =>
                    updateMapping(field.key as keyof typeof mapping, val)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a column..." />
                  </SelectTrigger>
                  <SelectContent>
                    {headers.map((header) => (
                      <SelectItem key={header} value={header}>
                        {header}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>

        {/* Optional Section */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Optional
          </h3>
          <div className="space-y-4">
            {optionalFields.map((field) => (
              <div
                key={field.key}
                className="grid grid-cols-2 gap-8 items-center"
              >
                <div className="font-medium text-sm">{field.label}</div>
                <Select
                  value={mapping[field.key as keyof typeof mapping] || "skip"}
                  onValueChange={(val) =>
                    updateMapping(
                      field.key as keyof typeof mapping,
                      val === "skip" ? "" : val
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a column..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip"> (Skip)</SelectItem>
                    {headers.map((header) => (
                      <SelectItem key={header} value={header}>
                        {header}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-6 border-t flex justify-end gap-2">
        <Button variant="outline" onClick={() => setStep("upload")}>
          Back
        </Button>
        <Button onClick={handleNext}>Next</Button>
      </div>
    </div>
  );
}
