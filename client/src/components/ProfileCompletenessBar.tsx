import { Progress } from "@/components/ui/progress";
import {
  calculateProfileCompleteness,
  getProgressColor,
} from "@/utils/profileHelpers";
import { UserProfile } from "@/hooks/use-settings";

interface ProfileCompletenessBarProps {
  profile: UserProfile | undefined;
}

export function ProfileCompletenessBar({
  profile,
}: ProfileCompletenessBarProps) {
  const { percentage, suggestions } = calculateProfileCompleteness(profile);

  return (
    <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-blue-100 shadow-sm hover:shadow-md transition-shadow duration-200">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-foreground">
          Profile Completeness
        </span>
        <span className="text-sm font-bold text-foreground">{percentage}%</span>
      </div>
      <Progress
        value={percentage}
        className={`h-2 ${getProgressColor(percentage)}`}
      />
      {percentage === 100 ? (
        <p className="mt-3 text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
          🎉 Profile 100% complete!
        </p>
      ) : suggestions.length > 0 ? (
        <div className="mt-3 space-y-1">
          {suggestions.map((suggestion, index) => (
            <p key={index} className="text-xs text-muted-foreground">
              💡 {suggestion}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
