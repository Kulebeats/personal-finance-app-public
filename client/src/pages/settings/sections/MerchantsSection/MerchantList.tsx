import React, { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Plus } from 'lucide-react';
import { MerchantCard } from './MerchantCard';

interface Merchant {
  id: number;
  name: string;
  category?: string;
  transactionCount: number;
  lastTransactionDate: string;
  isArchived: boolean;
}

interface MerchantListProps {
  merchants: Merchant[];
  onMerchantEdit: (merchant: Merchant) => void;
  onMerchantMerge: (merchantIds: number[]) => void;
  onMerchantArchive: (merchantId: number) => void;
}

export function MerchantList({ 
  merchants, 
  onMerchantEdit, 
  onMerchantMerge, 
  onMerchantArchive 
}: MerchantListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [selectedMerchants, setSelectedMerchants] = useState<number[]>([]);

  // Task 15.1: Memoized filtering function to avoid recalculation on every render
  const filteredMerchants = useMemo(() => {
    return merchants.filter(merchant => {
      // Filter by search term
      const matchesSearch = merchant.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           (merchant.category?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false);
      
      // Filter by archived status
      const matchesArchiveFilter = showArchived || !merchant.isArchived;
      
      return matchesSearch && matchesArchiveFilter;
    });
  }, [merchants, searchTerm, showArchived]);

  // Task 15.1: Memoized merchant count calculation
  const merchantStats = useMemo(() => {
    const active = merchants.filter(m => !m.isArchived).length;
    const archived = merchants.filter(m => m.isArchived).length;
    const total = merchants.length;
    
    return { active, archived, total };
  }, [merchants]);

  const handleSelectMerchant = (merchantId: number) => {
    setSelectedMerchants(prev => 
      prev.includes(merchantId) 
        ? prev.filter(id => id !== merchantId)
        : [...prev, merchantId]
    );
  };

  const handleMergeSelected = () => {
    if (selectedMerchants.length >= 2) {
      onMerchantMerge(selectedMerchants);
      setSelectedMerchants([]);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search and Filter Controls */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search merchants..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
            aria-label="Search merchants by name or category"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant={showArchived ? "default" : "outline"}
            onClick={() => setShowArchived(!showArchived)}
            size="sm"
            aria-label={showArchived ? 'Hide archived merchants' : 'Show archived merchants'}
          >
            {showArchived ? 'Hide Archived' : 'Show Archived'}
          </Button>
          <Button size="sm" aria-label="Add new merchant">
            <Plus className="h-4 w-4 mr-2" />
            Add Merchant
          </Button>
        </div>
      </div>

      {/* Merchant Stats */}
      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>Total: {merchantStats.total}</span>
        <span>Active: {merchantStats.active}</span>
        <span>Archived: {merchantStats.archived}</span>
        <span>Filtered: {filteredMerchants.length}</span>
      </div>

      {/* Bulk Actions */}
      {selectedMerchants.length > 0 && (
        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
          <span className="text-sm">
            {selectedMerchants.length} merchant{selectedMerchants.length !== 1 ? 's' : ''} selected
          </span>
          <Button
            size="sm"
            onClick={handleMergeSelected}
            disabled={selectedMerchants.length < 2}
            aria-label={`Merge ${selectedMerchants.length} selected merchants`}
          >
            Merge Selected
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelectedMerchants([])}
            aria-label="Clear merchant selection"
          >
            Clear Selection
          </Button>
        </div>
      )}

      {/* Merchant List */}
      <div className="space-y-2">
        {filteredMerchants.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {searchTerm ? 'No merchants found matching your search.' : 'No merchants found.'}
          </div>
        ) : (
          filteredMerchants.map(merchant => (
            <MerchantCard
              key={merchant.id}
              merchant={merchant}
              isSelected={selectedMerchants.includes(merchant.id)}
              onSelect={() => handleSelectMerchant(merchant.id)}
              onEdit={() => onMerchantEdit(merchant)}
              onArchive={() => onMerchantArchive(merchant.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}