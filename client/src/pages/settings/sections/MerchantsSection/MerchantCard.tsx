import React, { memo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { 
  MoreHorizontal, 
  Edit, 
  Archive,
  ArchiveRestore,
  Calendar,
  Hash
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Merchant {
  id: number;
  name: string;
  category?: string;
  transactionCount: number;
  lastTransactionDate: string;
  isArchived: boolean;
}

interface MerchantCardProps {
  merchant: Merchant;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onArchive: () => void;
}

// Task 15.3: Apply React.memo to prevent re-rendering unchanged items
export const MerchantCard = memo<MerchantCardProps>(({ 
  merchant, 
  isSelected, 
  onSelect, 
  onEdit, 
  onArchive 
}) => {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <Card className={`transition-colors ${isSelected ? 'ring-2 ring-primary' : ''} ${merchant.isArchived ? 'opacity-60' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          {/* Selection Checkbox */}
          <Checkbox
            checked={isSelected}
            onCheckedChange={onSelect}
            aria-label={`Select ${merchant.name}`}
          />

          {/* Merchant Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium truncate">{merchant.name}</h3>
              {merchant.isArchived && (
                <Badge variant="secondary" className="text-xs">
                  Archived
                </Badge>
              )}
            </div>
            
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {merchant.category && (
                <span className="flex items-center gap-1">
                  <Badge variant="outline" className="text-xs">
                    {merchant.category}
                  </Badge>
                </span>
              )}
              
              <span className="flex items-center gap-1">
                <Hash className="h-3 w-3" aria-hidden="true" />
                <span aria-label={`${merchant.transactionCount} transactions`}>
                  {merchant.transactionCount} transaction{merchant.transactionCount !== 1 ? 's' : ''}
                </span>
              </span>

              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" aria-hidden="true" />
                <span aria-label={`Last transaction on ${formatDate(merchant.lastTransactionDate)}`}>
                  Last: {formatDate(merchant.lastTransactionDate)}
                </span>
              </span>
            </div>
          </div>

          {/* Actions Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Open menu for {merchant.name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Edit className="h-4 w-4 mr-2" aria-hidden="true" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onArchive}>
                {merchant.isArchived ? (
                  <>
                    <ArchiveRestore className="h-4 w-4 mr-2" aria-hidden="true" />
                    Unarchive
                  </>
                ) : (
                  <>
                    <Archive className="h-4 w-4 mr-2" aria-hidden="true" />
                    Archive
                  </>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
});

MerchantCard.displayName = 'MerchantCard';