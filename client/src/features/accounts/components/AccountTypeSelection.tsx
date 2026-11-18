import {
  Landmark,
  CreditCard,
  TrendingUp,
  Home,
  Car,
  Smartphone,
  Wallet,
  Banknote,
} from "lucide-react";

import { AccountType } from "./AccountModalData";
import { AccountTypeCard } from "./AccountTypeCard";

type AccountTypeSelectionProps = {
  onSelectType: (type: AccountType) => void;
};

export function AccountTypeSelection({ onSelectType }: AccountTypeSelectionProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <AccountTypeCard
        icon={Landmark}
        label="Bank Account"
        sublabel="FNB, ZANACO, Absa..."
        onClick={() => onSelectType("bank")}
      />
      <AccountTypeCard
        icon={Smartphone}
        label="Mobile Money"
        sublabel="Airtel, MTN, Zamtel"
        onClick={() => onSelectType("mobile-money")}
      />
      <AccountTypeCard
        icon={Banknote}
        label="Cash"
        sublabel="Physical Cash"
        onClick={() => onSelectType("cash")}
      />
      <AccountTypeCard
        icon={TrendingUp}
        label="Investment"
        sublabel="BOZ Bonds, Stocks"
        onClick={() => onSelectType("investment")}
      />
      <AccountTypeCard
        icon={CreditCard}
        label="Credit Card"
        sublabel="Visa, Mastercard"
        onClick={() => onSelectType("credit")}
      />
      <AccountTypeCard
        icon={CreditCard}
        label="Loan"
        sublabel="Personal, Student"
        onClick={() => onSelectType("loan")}
      />
      <AccountTypeCard
        icon={Home}
        label="Mortgage"
        sublabel="Home Loan"
        onClick={() => onSelectType("mortgage")}
      />
      <AccountTypeCard
        icon={Wallet}
        label="Other Liability"
        sublabel="Unsecured Debt"
        onClick={() => onSelectType("other-liability")}
      />
      <AccountTypeCard
        icon={Home}
        label="Property"
        sublabel="Real Estate, Land"
        onClick={() => onSelectType("property")}
      />
      <AccountTypeCard
        icon={Car}
        label="Vehicle"
        sublabel="Car, Boat, RV"
        onClick={() => onSelectType("vehicle")}
      />
      <AccountTypeCard
        icon={Wallet}
        label="Other"
        sublabel="Custom Asset"
        onClick={() => onSelectType("other")}
      />
    </div>
  );
}
