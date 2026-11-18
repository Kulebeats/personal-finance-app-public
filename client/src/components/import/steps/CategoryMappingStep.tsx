import { useImportWizard } from "../ImportWizardContext";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";

interface Category {
  id: string;
  name: string;
  icon: string;
}

export function CategoryMappingStep() {
  const {
    parsedData,
    mapping,
    categoryMapping,
    updateCategoryMapping,
    setStep,
  } = useImportWizard();

  // Fetch System Categories
  const { data: response } = useQuery<{ data: { categories: Category[] } }>({
    queryKey: ["/api/categories"],
  });

  const categories = response?.data?.categories || [];

  // Extract unique categories from CSV
  const csvCategoryColumn = mapping.category;
  const csvCategories = parsedData?.rows
    .map((row) => row[csvCategoryColumn || ""])
    .filter(Boolean) // Filter empty
    .reduce((acc, curr) => {
      acc[curr] = (acc[curr] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  const uniqueCsvCategories = Object.entries(csvCategories || {});

  const handleNext = () => {
    setStep("review");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b">
        <h2 className="text-xl font-semibold">
          Assign CSV categories to CopperCoin categories
        </h2>
        <p className="text-muted-foreground text-sm">
          Map the categories in your CSV to your categories in CopperCoin. You
          can edit category names and emojis at any time from your settings
          page.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-0">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted/50 font-medium text-muted-foreground border-b uppercase text-xs">
            <tr>
              <th className="p-4 w-1/3">Category in CSV</th>
              <th className="p-4 w-1/3">CopperCoin Category</th>
              <th className="p-4 w-1/3 text-right">Transactions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {uniqueCsvCategories.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="p-8 text-center text-muted-foreground"
                >
                  No categories found in CSV column "{mapping.category}"
                </td>
              </tr>
            )}
            {uniqueCsvCategories.map(([csvCat, count]) => (
              <tr key={csvCat} className="hover:bg-muted/5">
                <td className="p-4 font-medium">{csvCat}</td>
                <td className="p-4">
                  <Select
                    value={categoryMapping[csvCat] || "new"}
                    onValueChange={(val) => updateCategoryMapping(csvCat, val)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      <SelectItem value="new">
                        + Add as a new expense category
                      </SelectItem>
                      {categories?.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          <span className="mr-2">{cat.icon}</span>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="p-4 text-right">{String(count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="p-6 border-t flex justify-end gap-2">
        <Button variant="outline" onClick={() => setStep("column-mapping")}>
          Back
        </Button>
        <Button onClick={handleNext}>Next</Button>
      </div>
    </div>
  );
}
