import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCareContext } from '../providers/CareContextProvider'
import { ShieldCheck, ClipboardList, FileText, LayoutDashboard, Receipt, UploadCloud } from 'lucide-react'
import { ImportInsuranceClaimsModal } from '../components/insurance/ImportInsuranceClaimsModal'
import { PatientCareHeader } from '../components/patients/PatientCareHeader'
import { InsurancePatientRegisterList } from '../components/insurance/InsurancePatientRegisterList'
import { CreateInsurancePatientRegisterModal } from '../components/insurance/CreateInsurancePatientRegisterModal'
import { InsuranceClaimList } from '../components/insurance/InsuranceClaimList'
import { CreateInsuranceClaimModal } from '../components/insurance/CreateInsuranceClaimModal'
import { InsuranceClaimsDashboard } from '../components/insurance/InsuranceClaimsDashboard'
import { InvoicesNeedingClaimList } from '../components/insurance/InvoicesNeedingClaimList'
import { HealthInsuranceList } from '../components/insurance/HealthInsuranceList'
import { CreateHealthInsuranceModal } from '../components/insurance/CreateHealthInsuranceModal'
import { DashboardCard } from '../components/ui/DashboardCard'
import type { InvoiceNeedingClaimRow } from '../services/common'

type Tab = 'dashboard' | 'invoices-needing-claim' | 'health-insurance' | 'registers' | 'claims'

const NAV_CARDS = [
  {
    id: 'dashboard' as Tab,
    title: 'Dashboard',
    desc: 'Claims overview, insurance & category summary',
    icon: LayoutDashboard,
    color: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    iconColor: 'text-indigo-600',
  },
  {
    id: 'invoices-needing-claim' as Tab,
    title: 'Invoices Needing Claim',
    desc: 'Draft & unpaid insured invoices without a claim yet',
    icon: Receipt,
    color: 'bg-orange-50 text-orange-700 border-orange-200',
    iconColor: 'text-orange-600',
  },
  {
    id: 'health-insurance' as Tab,
    title: 'Health Insurance',
    desc: 'Manage insurance plans, discounts & coverage',
    icon: ShieldCheck,
    color: 'bg-primary/10 text-primary border-primary/20',
    iconColor: 'text-primary',
  },
  {
    id: 'registers' as Tab,
    title: 'Insurance Patient Register',
    desc: 'Track approvals and link to patient records',
    icon: ClipboardList,
    color: 'bg-green-50 text-green-700 border-green-200',
    iconColor: 'text-green-600',
  },
  {
    id: 'claims' as Tab,
    title: 'Insurance Claims',
    desc: 'Claim submissions and payment tracking',
    icon: FileText,
    color: 'bg-purple-50 text-purple-700 border-purple-200',
    iconColor: 'text-purple-600',
  },
]

const DEFAULT_TAB: Tab = 'dashboard'

function parseInsuranceTab(value: string | null): Tab {
  if (value && NAV_CARDS.some(c => c.id === value)) return value as Tab
  return DEFAULT_TAB
}

export const InsurancePage = () => {
  const { selectedPatient: globalPatient, setSelectedPatient: setGlobalPatient, companyCurrency } = useCareContext()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = parseInsuranceTab(searchParams.get('tab'))
  const [selectedPatient, setSelectedPatient] = useState<string | undefined>(
    () => searchParams.get('patient') || globalPatient || undefined
  )

  const [registerRefreshKey, setRegisterRefreshKey] = useState(0)
  const [showCreateRegister, setShowCreateRegister] = useState(false)

  const [claimRefreshKey, setClaimRefreshKey] = useState(0)
  const [showCreateClaim, setShowCreateClaim] = useState(false)
  const [showImportClaims, setShowImportClaims] = useState(false)
  const [editClaimName, setEditClaimName] = useState<string | undefined>()
  const [claimFromInvoice, setClaimFromInvoice] = useState<InvoiceNeedingClaimRow | undefined>()

  const [hiRefreshKey, setHiRefreshKey] = useState(0)
  const [showCreateHI, setShowCreateHI] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const setActiveTab = (tab: Tab) => {
    const p = new URLSearchParams(searchParams)
    if (tab === DEFAULT_TAB) p.delete('tab')
    else p.set('tab', tab)
    setSearchParams(p, { replace: true })
  }

  const handlePatientSelect = (patient: string | undefined) => {
    setSelectedPatient(patient)
    setGlobalPatient(patient)
    const p = new URLSearchParams(searchParams)
    if (patient) p.set('patient', patient)
    else p.delete('patient')
    setSearchParams(p, { replace: true })
  }

  const bumpClaims = () => setClaimRefreshKey(k => k + 1)

  const openCreateClaim = (invoice?: InvoiceNeedingClaimRow) => {
    setEditClaimName(undefined)
    setClaimFromInvoice(invoice)
    setShowCreateClaim(true)
  }

  const openEditClaim = (claimName: string) => {
    setClaimFromInvoice(undefined)
    setEditClaimName(claimName)
    setShowCreateClaim(true)
  }

  const closeClaimModal = () => {
    setShowCreateClaim(false)
    setEditClaimName(undefined)
    setClaimFromInvoice(undefined)
  }

  const activeCard = NAV_CARDS.find(c => c.id === activeTab)!

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <PatientCareHeader selectedPatient={selectedPatient || ''} onPatientSelect={handlePatientSelect} patients={[]} />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Navigation cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {NAV_CARDS.map(card => {
            const Icon = card.icon
            const isActive = activeTab === card.id
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => setActiveTab(card.id)}
                className={`flex items-start gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all hover:shadow-md ${
                  isActive
                    ? `${card.color} shadow-sm`
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                <div className={`p-2 rounded-lg ${isActive ? 'bg-white/60' : 'bg-slate-100'}`}>
                  <Icon className={`w-5 h-5 ${isActive ? card.iconColor : 'text-slate-500'}`} />
                </div>
                <div>
                  <p className={`text-sm font-semibold ${isActive ? '' : 'text-slate-800'}`}>{card.title}</p>
                  <p className={`text-xs mt-0.5 ${isActive ? 'opacity-80' : 'text-slate-500'}`}>{card.desc}</p>
                </div>
              </button>
            )
          })}
        </div>

        {/* Active section — unified DashboardCard (matches the Doctor module) */}
        <DashboardCard
          title={activeCard.title}
          filterable={false}
          noHeightLimit
          headerExtra={
            <>
              {activeTab !== 'dashboard' && (
                <button
                  type="button"
                  onClick={() => setShowFilters(prev => !prev)}
                  className={`p-1.5 rounded-md border transition-colors ${showFilters ? 'bg-primary/10 border-primary text-primary' : 'border-slate-300 text-slate-500 hover:bg-slate-50'}`}
                  title={showFilters ? 'Hide filters' : 'Show filters'}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
                </button>
              )}
              {activeTab === 'health-insurance' && (
                <button
                  onClick={() => setShowCreateHI(true)}
                  className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/90 transition-colors text-sm font-bold"
                  title="New Health Insurance"
                >
                  +
                </button>
              )}
              {activeTab === 'registers' && (
                <button
                  onClick={() => setShowCreateRegister(true)}
                  className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/90 transition-colors text-sm font-bold"
                  title="New Insurance Patient Register"
                >
                  +
                </button>
              )}
              {activeTab === 'claims' && (
                <>
                  <button
                    onClick={() => setShowImportClaims(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 h-7 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                    title="Import legacy insurance claims from Excel"
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    Import
                  </button>
                  <button
                    onClick={() => openCreateClaim()}
                    className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/90 transition-colors text-sm font-bold"
                    title="New Insurance Claim"
                  >
                    +
                  </button>
                </>
              )}
            </>
          }
        >
          {activeTab === 'dashboard' && (
            <InsuranceClaimsDashboard
              patient={selectedPatient}
              currency={companyCurrency}
              refreshKey={claimRefreshKey}
            />
          )}
          {activeTab === 'invoices-needing-claim' && (
            <InvoicesNeedingClaimList
              patient={selectedPatient}
              refreshKey={claimRefreshKey}
              showFilters={showFilters}
              onPatientClick={handlePatientSelect}
              onCreateClaim={openCreateClaim}
            />
          )}
          {activeTab === 'health-insurance' && (
            <HealthInsuranceList refreshKey={hiRefreshKey} showFilters={showFilters} />
          )}
          {activeTab === 'registers' && (
            <InsurancePatientRegisterList
              refreshKey={registerRefreshKey}
              showFilters={showFilters}
              onPatientClick={handlePatientSelect}
            />
          )}
          {activeTab === 'claims' && (
            <InsuranceClaimList
              refreshKey={claimRefreshKey}
              patient={selectedPatient}
              onPatientClick={handlePatientSelect}
              showFilters={showFilters}
              onEditDraft={openEditClaim}
              onRefresh={bumpClaims}
            />
          )}
        </DashboardCard>
      </div>

      {/* Modals */}
      {showCreateHI && (
        <CreateHealthInsuranceModal
          onClose={() => setShowCreateHI(false)}
          onSuccess={() => {
            setShowCreateHI(false)
            setHiRefreshKey(k => k + 1)
          }}
        />
      )}

      {showCreateRegister && (
        <CreateInsurancePatientRegisterModal
          onClose={() => setShowCreateRegister(false)}
          onSuccess={() => {
            setShowCreateRegister(false)
            setRegisterRefreshKey(k => k + 1)
          }}
        />
      )}

      {showImportClaims && (
        <ImportInsuranceClaimsModal
          onClose={() => setShowImportClaims(false)}
          onImported={bumpClaims}
        />
      )}

      {showCreateClaim && (
        <CreateInsuranceClaimModal
          onClose={closeClaimModal}
          initialPatient={selectedPatient}
          initialInvoice={claimFromInvoice}
          editClaimName={editClaimName}
          onSuccess={() => {
            closeClaimModal()
            bumpClaims()
          }}
        />
      )}
    </div>
  )
}
