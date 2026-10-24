import type { Company, Individual } from '../shared/types';

/** Stand-in for Companies House: a fixed list of fictional UK companies with their officers. */
export interface RegistryCompany {
  company: Company;
  directors: Individual[];
}

const addr = (addressLine1: string, city: string, postCode: string) => ({
  addressLine1,
  city,
  postCode,
  countryCode: 'GB',
});

const person = (firstName: string, lastName: string, dateOfBirth: string, city: string): Individual => ({
  firstName,
  lastName,
  dateOfBirth,
  nationality: 'GB',
  countryOfResidence: 'GB',
  email: `${firstName}.${lastName}@example.com`.toLowerCase(),
  address: addr(`${10 + firstName.length} High Street`, city, 'EC1A 1BB'),
});

const co = (name: string, registrationNumber: string, line1: string, city: string, postCode: string, directors: Individual[]): RegistryCompany => ({
  company: {
    name,
    jurisdiction: 'GB',
    registrationNumber,
    registeredAddress: addr(line1, city, postCode),
    operationsAddress: addr(line1, city, postCode),
  },
  directors,
});

export const REGISTRY: RegistryCompany[] = [
  co('ClickCash Ltd', '10293847', '1 Finsbury Square', 'London', 'EC2A 1AE', [person('Amelia', 'Hart', '1981-03-14', 'London'), person('Oliver', 'Grant', '1975-11-02', 'London')]),
  co('PayMate Payments Ltd', '11384756', '22 Bishopsgate', 'London', 'EC2N 4BQ', [person('Isla', 'Morgan', '1986-07-21', 'London')]),
  co('Walletly Ltd', '09876123', '5 Deansgate', 'Manchester', 'M3 2BW', [person('George', 'Patel', '1979-01-30', 'Manchester'), person('Freya', 'Collins', '1990-05-09', 'Manchester')]),
  co('DigiCash Services Ltd', '12039485', '40 Queen Street', 'Edinburgh', 'EH2 3NH', [person('Harry', 'Douglas', '1972-09-17', 'Edinburgh')]),
  co('CreditBond Ltd', '08765432', '3 Temple Row', 'Birmingham', 'B2 5LG', [person('Sophie', 'Fail', '1984-12-01', 'Birmingham')]),
  co('Northwind Remit Ltd', '13579246', '18 Park Row', 'Leeds', 'LS1 5JL', [person('Jack', 'Turner', '1988-04-11', 'Leeds'), person('Ava', 'Bennett', '1991-08-23', 'Leeds')]),
  co('Bluepeak Money Ltd', '14725836', '9 Corn Street', 'Bristol', 'BS1 1HT', [person('Noah', 'Hughes', '1983-02-15', 'Bristol')]),
  co('Silverline FX Ltd', '15935728', '77 Gracechurch Street', 'London', 'EC3V 0AS', [person('Emily', 'Shaw', '1977-06-06', 'London'), person('Thomas', 'Reid', '1969-10-28', 'London')]),
  co('Harbour Pay Ltd', '16248357', '2 Canute Road', 'Southampton', 'SO14 3FJ', [person('Lily', 'Carter', '1993-03-03', 'Southampton')]),
  co('Meridian Transfers Ltd', '17395184', '60 St Vincent Street', 'Glasgow', 'G2 5TS', [person('Charlie', 'Murray', '1980-12-12', 'Glasgow')]),
  co('Kestrel Payments Ltd', '18426095', '11 Castle Street', 'Cardiff', 'CF10 1BS', [person('Grace', 'Evans', '1987-09-19', 'Cardiff')]),
  co('Orbit Wallet Ltd', '19573826', '14 Bold Street', 'Liverpool', 'L1 4DS', [person('Jacob', 'Wright', '1985-05-25', 'Liverpool'), person('Mia', 'Price', '1992-01-07', 'Liverpool')]),
  co('Failsafe Remittance Ltd', '20684937', '8 Grey Street', 'Newcastle', 'NE1 6AE', [person('Leo', 'Fail', '1974-07-04', 'Newcastle')]),
  co('Thistle Money Ltd', '21795048', '25 Union Street', 'Aberdeen', 'AB11 6BA', [person('Ella', 'Stewart', '1989-11-14', 'Aberdeen')]),
  co('Copperleaf Pay Ltd', '22806159', '6 Market Square', 'Nottingham', 'NG1 2DP', [person('Henry', 'Walsh', '1976-03-29', 'Nottingham')]),
  co('Quayside Exchange Ltd', '23917260', '31 Victoria Street', 'Belfast', 'BT1 3GG', [person('Ruby', 'Kelly', '1990-02-18', 'Belfast')]),
  co('EMoney Plus Ltd', '07654321', '100 Liverpool Street', 'London', 'EC2M 2RH', [person('Daniel', 'Moore', '1970-08-08', 'London')]),
];

export function searchRegistry(query: string): RegistryCompany[] {
  const q = query.trim().toLowerCase();
  if (!q) return REGISTRY.slice(0, 10);
  return REGISTRY.filter((r) => r.company.name.toLowerCase().includes(q) || r.company.registrationNumber.includes(q));
}

export function registryCompany(registrationNumber: string): RegistryCompany | undefined {
  return REGISTRY.find((r) => r.company.registrationNumber === registrationNumber);
}
