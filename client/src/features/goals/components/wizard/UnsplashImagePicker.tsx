import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Search, Image as ImageIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Curated high-quality images for common categories to ensure the UI looks great out of the box
const CURATED_IMAGES = {
  vacation: [
    "https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=800&q=80",
  ],
  home: [
    "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=80",
  ],
  car: [
    "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1503376763036-066120622c74?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1533473359331-0135ef1bcfb0?auto=format&fit=crop&w=800&q=80",
  ],
  wedding: [
    "https://images.unsplash.com/photo-1519225421980-715cb0202128?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=800&q=80",
  ],
  emergency: [
    "https://images.unsplash.com/photo-1580519542036-c47de6196ba5?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1611974765270-ca1258634369?auto=format&fit=crop&w=800&q=80",
  ],
  other: [
    "https://images.unsplash.com/photo-1472289065668-ce650ac443d2?auto=format&fit=crop&w=800&q=80", // Success/Mountain
    "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=800&q=80", // Money
  ],
};

interface UnsplashImagePickerProps {
  onSelect: (url: string) => void;
  selectedUrl?: string;
  defaultQuery?: string;
  className?: string;
}

export function UnsplashImagePicker({
  onSelect,
  selectedUrl,
  defaultQuery = "goals",
  className,
}: UnsplashImagePickerProps) {
  const [query, setQuery] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Initial load
  useEffect(() => {
    // Map defaultQuery (template id) to our curated list keys
    let key = "other";
    if (defaultQuery.includes("vacation") || defaultQuery.includes("trip"))
      key = "vacation";
    if (defaultQuery.includes("home") || defaultQuery.includes("house"))
      key = "home";
    if (defaultQuery.includes("car") || defaultQuery.includes("vehicle"))
      key = "car";
    if (defaultQuery.includes("wedding")) key = "wedding";
    if (defaultQuery.includes("emergency")) key = "emergency";

    const initialImages =
      CURATED_IMAGES[key as keyof typeof CURATED_IMAGES] ||
      CURATED_IMAGES["other"];
    setImages(initialImages);
    setQuery(defaultQuery.replace("_", " ")); // Pre-fill search box
  }, [defaultQuery]);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query) return;

    setLoading(true);
    // Uses curated high-quality images for reliable display without API key dependency
    setTimeout(() => {

      let results = [...(CURATED_IMAGES.other || [])];
      if (query.toLowerCase().includes("travel"))
        results = CURATED_IMAGES.vacation;
      else if (query.toLowerCase().includes("house"))
        results = CURATED_IMAGES.home;

      setImages(results);
      setLoading(false);
    }, 600);
  };

  return (
    <div className={cn("space-y-3", className)}>
      <Label>Cover Image</Label>

      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search photos..."
            aria-label="Search for cover images"
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary" disabled={loading} aria-label="Search for images">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : "Search"}
        </Button>
      </form>

      <ScrollArea className="w-full whitespace-nowrap rounded-md border">
        <div className="flex w-max space-x-4 p-4">
          {images.map((url, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(url)}
              aria-label={`Select cover image ${i + 1}${selectedUrl === url ? ', currently selected' : ''}`}
              className={cn(
                "relative flex-shrink-0 overflow-hidden rounded-md transition-all hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                "h-[120px] w-[200px]",
                selectedUrl === url && "ring-2 ring-primary ring-offset-2"
              )}
            >
              <img
                src={url}
                alt=""
                className="h-full w-full object-cover"
              />
              {selectedUrl === url && (
                <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                  <div className="bg-primary text-primary-foreground rounded-full p-1">
                    <ImageIcon className="w-4 h-4" aria-hidden="true" />
                  </div>
                </div>
              )}
            </button>
          ))}
          {/* Add more placeholders if list is short to show horizontal scroll potential */}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
