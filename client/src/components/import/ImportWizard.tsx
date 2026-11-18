import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useImportWizard } from "./ImportWizardContext";
import { UploadStep } from "./steps/UploadStep";
import { ColumnAssignmentStep } from "./steps/ColumnAssignmentStep";
import { CategoryMappingStep } from "./steps/CategoryMappingStep";
import { ReviewStep } from "./steps/ReviewStep";
import { ProgressModal } from "./steps/ProgressModal";

export function ImportWizard() {
  const { isOpen, closeWizard, currentStep } = useImportWizard();

  // Prevent closing by clicking outside during critical steps
  const isBlocking = currentStep === "progress" || currentStep === "success";

  const renderStep = () => {
    switch (currentStep) {
      case "upload":
        return <UploadStep />;
      case "column-mapping":
        return <ColumnAssignmentStep />;
      case "category-mapping":
        return <CategoryMappingStep />;
      case "review":
        return <ReviewStep />;
      case "progress":
        return <ProgressModal />;
      case "success":
        // ProgressModal handles success state internally usually, or we can separate
        return <ProgressModal />; 
      default:
        return <div>Unknown Step</div>;
    }
  };

  return (
    <Dialog 
      open={isOpen} 
      onOpenChange={(open) => {
        if (!open && !isBlocking) {
            closeWizard();
        }
      }}
    >
      <DialogContent className="max-w-4xl h-[calc(100dvh-2rem)] sm:h-auto sm:min-h-[600px] flex flex-col p-0 gap-0 overflow-hidden bg-background sm:rounded-xl">
        {/* We can add a global wizard header here if needed, but steps have their own headers currently */}
        <div className="flex-1 overflow-y-auto w-full">
            {renderStep()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
