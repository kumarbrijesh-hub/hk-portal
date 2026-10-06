import React, { useState, useEffect, useMemo } from 'react';
import {
  Building2,
  Calendar,
  Clock,
  KeyRound,
  UserCheck,
  Tag,
  Ticket,
  Activity,
  AlertCircle,
  CheckCircle,
  CheckCircle2,
  Database,
  Search,
  MessageSquare,
  PlusCircle,
  RotateCcw,
} from 'lucide-react';
import {
  BucketType,
  CurrentStatus,
  CURRENT_STATUS_OPTIONS,
  OutletMaster,
  RESOLVED_STATUSES_REQUIRING_ISSUE,
  Disruption,
} from '../types';
import { generateDisruptionId } from '../utils/idGenerator';
import { formatDateTimeIST, getCurrentISTDate } from '../utils/dateUtils';

interface LiveTrackerFormProps {
  outlets: OutletMaster[];
  ccPocOptions: string[];
  issueMaster: Record<string, string[]>;
  currentUser: string;
  existingDisruptions: Disruption[];
  onSubmitSuccess: (disruption: Disruption) => void;
  onOpenSyncModal?: () => void;
}

export const LiveTrackerForm: React.FC<LiveTrackerFormProps> = ({
  outlets,
  ccPocOptions,
  issueMaster,
  currentUser,
  existingDisruptions,
  onSubmitSuccess,
  onOpenSyncModal,
}) => {
  // Form State - Manual Entry of Outlet ID & Store Details Supported
  const [outletIdInput, setOutletIdInput] = useState('');
  const [storeNameInput, setStoreNameInput] = useState('');
  const [cityInput, setCityInput] = useState('');
  const [modeInput, setModeInput] = useState('Dark Store');
  const [vendorInput, setVendorInput] = useState('RAC');
  const [pocNameInput, setPocNameInput] = useState('');
  const [pocContactInput, setPocContactInput] = useState('');

  // AMC & Escalation LOD fields (Auto-populated from Google Sheet)
  const [amcCoverageInput, setAmcCoverageInput] = useState('');
  const [currentVendorInput, setCurrentVendorInput] = useState('');
  const [lodL1NameInput, setLodL1NameInput] = useState('');
  const [lodL1EmailInput, setLodL1EmailInput] = useState('');
  const [lodL1ContactInput, setLodL1ContactInput] = useState('');
  const [lodL2NameInput, setLodL2NameInput] = useState('');
  const [lodL2EmailInput, setLodL2EmailInput] = useState('');
  const [lodL2ContactInput, setLodL2ContactInput] = useState('');
  const [lodL3NameInput, setLodL3NameInput] = useState('');
  const [lodL3EmailInput, setLodL3EmailInput] = useState('');
  const [lodL3ContactInput, setLodL3ContactInput] = useState('');
  const [regionInput, setRegionInput] = useState('');
  const [mstRacNameInput, setMstRacNameInput] = useState('');
  const [mstRacContactInput, setMstRacContactInput] = useState('');
  const [showEscalationDetails, setShowEscalationDetails] = useState(true);

  const [selectedOutlet, setSelectedOutlet] = useState<OutletMaster | null>(null);
  const [outletSearchOpen, setOutletSearchOpen] = useState(false);

  // Date & Time state
  const initialIST = useMemo(() => getCurrentISTDate(), []);
  const [startDate, setStartDate] = useState(initialIST.dateStr); // YYYY-MM-DD
  const [startTime, setStartTime] = useState(initialIST.timeStr); // HH:MM:SS

  // Other fields
  const [ccPoc, setCcPoc] = useState(currentUser || ccPocOptions[0] || 'Chirag');
  const [bucket, setBucket] = useState<BucketType>('Non Breakdown');
  const [ticketId, setTicketId] = useState('');
  const [currentStatus, setCurrentStatus] = useState<CurrentStatus>('No Update');
  const [selectedIssue, setSelectedIssue] = useState('');
  const [selectedSubIssue, setSelectedSubIssue] = useState('');
  const [liveUpdateText, setLiveUpdateText] = useState('');
  // First response times in minutes; blank stays blank rather than becoming 0.
  const [ccFrtInput, setCcFrtInput] = useState('');
  const [mstFrtInput, setMstFrtInput] = useState('');

  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<{ id: string; msg: string } | null>(null);

  // Synchronize ccPoc with currentUser when currentUser changes (if not modified)
  useEffect(() => {
    if (currentUser && ccPocOptions.includes(currentUser)) {
      setCcPoc(currentUser);
    }
  }, [currentUser, ccPocOptions]);

  // Fast Outlet Lookup when typing or selecting Outlet ID
  useEffect(() => {
    const clean = outletIdInput.trim().toUpperCase();
    if (!clean) {
      setSelectedOutlet(null);
      return;
    }
    const cleanNum = clean.replace(/[^0-9]/g, '');

    const match = outlets.find((o) => {
      const oid = (o.outletId || '').trim().toUpperCase();
      if (oid === clean) return true;
      if (oid === `OUT${clean}` || `OUT${oid}` === clean) return true;
      const oidNum = oid.replace(/[^0-9]/g, '');
      if (cleanNum && oidNum && cleanNum === oidNum && cleanNum.length >= 3) return true;
      return false;
    });

    if (match) {
      setSelectedOutlet(match);
      setStoreNameInput(match.storeName || '');
      setCityInput(match.city || '');
      setModeInput(match.mode || 'Dark Store');
      setVendorInput(match.vendor || match.currentVendor || 'RAC');
      setPocNameInput(match.pocName || match.coldPocName2 || '');
      setPocContactInput(match.pocContact || match.coldPocContact2 || '');
      setAmcCoverageInput(match.amcCoverage || '');
      setCurrentVendorInput(match.currentVendor || match.vendor || '');
      setLodL1NameInput(match.lodL1Name || '');
      setLodL1EmailInput(match.lodL1Email || '');
      setLodL1ContactInput(match.lodL1Contact || '');
      setLodL2NameInput(match.lodL2Name || '');
      setLodL2EmailInput(match.lodL2Email || '');
      setLodL2ContactInput(match.lodL2Contact || '');
      setLodL3NameInput(match.lodL3Name || '');
      setLodL3EmailInput(match.lodL3Email || '');
      setLodL3ContactInput(match.lodL3Contact || '');
      setRegionInput(match.region || '');
      setMstRacNameInput(match.mstRacName || '');
      setMstRacContactInput(match.mstRacContact || '');
    } else {
      setSelectedOutlet(null);
    }
  }, [outletIdInput, outlets]);

  // Dynamically extract all unique Vendors from Google Sheet Master Data
  const availableVendors = useMemo(() => {
    const set = new Set<string>();
    // Default baseline vendors
    ['RAC', 'OEM', 'Dealer', 'MST', 'Carrier', 'BlueStar', 'Voltas', 'CC', 'In-House'].forEach((v) => set.add(v));
    // Dynamic vendors from Google Sheet
    outlets.forEach((o) => {
      if (o.vendor && o.vendor.trim()) set.add(o.vendor.trim());
      if (o.currentVendor && o.currentVendor.trim()) set.add(o.currentVendor.trim());
    });
    if (vendorInput && vendorInput.trim()) {
      set.add(vendorInput.trim());
    }
    return Array.from(set);
  }, [outlets, vendorInput]);

  // Filter outlet suggestions for searchable input
  const filteredOutlets = useMemo(() => {
    if (!outletIdInput) return outlets.slice(0, 8);
    const q = outletIdInput.trim().toLowerCase();
    return outlets
      .filter(
        (o) =>
          o.outletId.toLowerCase().includes(q) ||
          o.storeName.toLowerCase().includes(q) ||
          o.city.toLowerCase().includes(q)
      )
      .slice(0, 10);
  }, [outlets, outletIdInput]);

  // Generate Disruption ID dynamically
  const generatedDisruptionId = useMemo(() => {
    if (!outletIdInput || !startDate || !startTime) return '';
    const base = generateDisruptionId(outletIdInput, startDate, startTime);
    if (!base) return '';

    // Check if ID already exists and handle safely
    const isDuplicate = existingDisruptions.some((d) => d.disruptionId === base);
    if (isDuplicate) {
      // Suffix with incremental duplicate identifier
      let counter = 1;
      while (existingDisruptions.some((d) => d.disruptionId === `${base}-${counter}`)) {
        counter++;
      }
      return `${base}-${counter}`;
    }
    return base;
  }, [outletIdInput, startDate, startTime, existingDisruptions]);

  // Conditional flags
  const isTicketIdMandatory = bucket === 'Breakdown';
  const isIssueMandatory = RESOLVED_STATUSES_REQUIRING_ISSUE.includes(currentStatus);

  // Available sub-issues based on selected issue
  const availableSubIssues = useMemo(() => {
    if (!selectedIssue || !issueMaster[selectedIssue]) return [];
    return issueMaster[selectedIssue];
  }, [selectedIssue, issueMaster]);

  // Reset issue when status changes away from resolved
  useEffect(() => {
    if (!isIssueMandatory) {
      setSelectedIssue('');
      setSelectedSubIssue('');
    } else if (!selectedIssue) {
      // Pick first available issue category
      const keys = Object.keys(issueMaster);
      if (keys.length > 0) {
        setSelectedIssue(keys[0]);
        if (issueMaster[keys[0]]?.length > 0) {
          setSelectedSubIssue(issueMaster[keys[0]][0]);
        }
      }
    }
  }, [isIssueMandatory, issueMaster]);

  // Reset sub-issue when issue category changes
  const handleIssueChange = (newIssue: string) => {
    setSelectedIssue(newIssue);
    const subList = issueMaster[newIssue] || [];
    setSelectedSubIssue(subList.length > 0 ? subList[0] : '');
  };

  const handleSetCurrentTime = () => {
    const { dateStr, timeStr } = getCurrentISTDate();
    setStartDate(dateStr);
    setStartTime(timeStr);
  };

  const handleSelectOutlet = (outlet: OutletMaster) => {
    setOutletIdInput(outlet.outletId);
    setSelectedOutlet(outlet);
    setStoreNameInput(outlet.storeName || '');
    setCityInput(outlet.city || '');
    setModeInput(outlet.mode || 'Dark Store');
    setVendorInput(outlet.vendor || 'RAC');
    setPocNameInput(outlet.pocName || '');
    setPocContactInput(outlet.pocContact || '');
    setOutletSearchOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    // 1. Mandatory Validations
    if (!outletIdInput.trim()) {
      setErrorMessage('Outlet ID is mandatory. Please enter an Outlet ID.');
      return;
    }
    if (!startDate || !startTime) {
      setErrorMessage('Disruption Start Date and Time are mandatory.');
      return;
    }
    if (!ccPoc) {
      setErrorMessage('CC POC is mandatory. Please select from the dropdown.');
      return;
    }
    if (!bucket) {
      setErrorMessage('Bucket is mandatory.');
      return;
    }
    // 2. Ticket ID validation
    if (isTicketIdMandatory && !ticketId.trim()) {
      setErrorMessage('Disruption Ticket ID is mandatory for Breakdown.');
      return;
    }
    if (!currentStatus) {
      setErrorMessage('Current Status is mandatory.');
      return;
    }
    // 3. Issue and Sub-Issue validation
    if (isIssueMandatory) {
      if (!selectedIssue || !selectedIssue.trim()) {
        setErrorMessage(`Issue is mandatory when Current Status is "${currentStatus}".`);
        return;
      }
      if (!selectedSubIssue || !selectedSubIssue.trim()) {
        setErrorMessage(`Sub Issue is mandatory when Current Status is "${currentStatus}".`);
        return;
      }
    }
    // 4. Live Update validation
    if (!liveUpdateText.trim()) {
      setErrorMessage('Live Update is mandatory. Please describe the initial operational situation.');
      return;
    }

    setIsSubmitting(true);

    try {
      const disruptionStartDateTime = formatDateTimeIST(startDate, startTime);

      const payload: Partial<Disruption> = {
        disruptionId: generatedDisruptionId,
        outletId: outletIdInput.trim().toUpperCase(),
        storeName: storeNameInput.trim() || selectedOutlet?.storeName || `Store ${outletIdInput.trim().toUpperCase()}`,
        city: cityInput.trim() || selectedOutlet?.city || 'Unspecified City',
        mode: modeInput.trim() || selectedOutlet?.mode || 'Dark Store',
        vendor: vendorInput.trim() || selectedOutlet?.vendor || 'RAC',
        pocName: pocNameInput.trim() || selectedOutlet?.pocName || selectedOutlet?.coldPocName2 || 'Store In-Charge',
        pocContact: pocContactInput.trim() || selectedOutlet?.pocContact || selectedOutlet?.coldPocContact2 || '+91 00000 00000',
        coldPocName2: pocNameInput.trim() || selectedOutlet?.pocName || selectedOutlet?.coldPocName2 || 'Store In-Charge',
        coldPocContact2: pocContactInput.trim() || selectedOutlet?.pocContact || selectedOutlet?.coldPocContact2 || '+91 00000 00000',
        amcCoverage: amcCoverageInput.trim() || selectedOutlet?.amcCoverage || '',
        currentVendor: currentVendorInput.trim() || selectedOutlet?.currentVendor || vendorInput.trim(),
        lodL1Name: lodL1NameInput.trim() || selectedOutlet?.lodL1Name || '',
        lodL1Email: lodL1EmailInput.trim() || selectedOutlet?.lodL1Email || '',
        lodL1Contact: lodL1ContactInput.trim() || selectedOutlet?.lodL1Contact || '',
        lodL2Name: lodL2NameInput.trim() || selectedOutlet?.lodL2Name || '',
        lodL2Email: lodL2EmailInput.trim() || selectedOutlet?.lodL2Email || '',
        lodL2Contact: lodL2ContactInput.trim() || selectedOutlet?.lodL2Contact || '',
        lodL3Name: lodL3NameInput.trim() || selectedOutlet?.lodL3Name || '',
        lodL3Email: lodL3EmailInput.trim() || selectedOutlet?.lodL3Email || '',
        lodL3Contact: lodL3ContactInput.trim() || selectedOutlet?.lodL3Contact || '',
        region: regionInput.trim() || selectedOutlet?.region || '',
        mstRacName: mstRacNameInput.trim() || selectedOutlet?.mstRacName || '',
        mstRacContact: mstRacContactInput.trim() || selectedOutlet?.mstRacContact || '',
        disruptionStartDateTime,
        disruptionStartDate: startDate,
        disruptionStartTime: startTime,
        ccPoc,
        bucket,
        ticketId: ticketId.trim() || undefined,
        currentStatus,
        issue: isIssueMandatory ? selectedIssue : undefined,
        subIssue: isIssueMandatory ? selectedSubIssue : undefined,
        latestLiveUpdate: liveUpdateText.trim(),
        ccFrtMins: ccFrtInput.trim() === '' ? undefined : Number(ccFrtInput),
        mstFrtMins: mstFrtInput.trim() === '' ? undefined : Number(mstFrtInput),
        createdBy: currentUser || ccPoc,
      };

      const res = await fetch('/api/disruptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${res.status}`);
      }

      const result = await res.json();
      setSuccessMessage({
        id: result.disruptionId,
        msg: 'Disruption created successfully.',
      });

      // Call parent callback to update tables and active count
      if (result.disruption) {
        onSubmitSuccess(result.disruption);
      }

      // Reset form fields
      setOutletIdInput('');
      setStoreNameInput('');
      setCityInput('');
      setModeInput('Dark Store');
      setVendorInput('RAC');
      setPocNameInput('');
      setPocContactInput('');
      setAmcCoverageInput('');
      setCurrentVendorInput('');
      setLodL1NameInput('');
      setLodL1EmailInput('');
      setLodL1ContactInput('');
      setLodL2NameInput('');
      setLodL2EmailInput('');
      setLodL2ContactInput('');
      setLodL3NameInput('');
      setLodL3EmailInput('');
      setLodL3ContactInput('');
      setRegionInput('');
      setMstRacNameInput('');
      setMstRacContactInput('');
      setSelectedOutlet(null);
      setTicketId('');
      setCurrentStatus('No Update');
      setLiveUpdateText('');
      setCcFrtInput('');
      setMstFrtInput('');
      setSelectedIssue('');
      setSelectedSubIssue('');
      handleSetCurrentTime();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to create disruption. Please try again.';
      setErrorMessage(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div id="live-tracker-creation-card" className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Card Header */}
      <div className="bg-slate-900 px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-red-500" />
            Create Disruption Incident
          </h2>
          <p className="text-xs text-slate-400">
            Enter Outlet ID and disruption details. Master data will auto-populate instantly.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSetCurrentTime}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-xs font-medium border border-slate-700 transition"
          title="Reset Start Time to Now"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Time to Now</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        {/* Success Alert Banner */}
        {successMessage && (
          <div
            id="creation-success-alert"
            className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-3"
          >
            <CheckCircle className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-emerald-900">{successMessage.msg}</h4>
              <p className="text-xs text-emerald-700 mt-0.5">
                Disruption ID: <span className="font-mono font-bold text-emerald-900">{successMessage.id}</span>
              </p>
            </div>
          </div>
        )}

        {/* Error Alert Banner */}
        {errorMessage && (
          <div
            id="creation-error-alert"
            className="p-4 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-3"
          >
            <AlertCircle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-rose-900">Validation Error</h4>
              <p className="text-xs text-rose-700 mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Step 1: Outlet ID & Store Details (Manual Entry Supported) */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-2 gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                1. Outlet ID (<span className="font-mono text-red-600">outlet_id</span>) & Store Details
              </span>
              <span className="text-[10px] bg-amber-100 text-amber-900 font-bold px-2 py-0.5 rounded border border-amber-200">
                Direct Entry (खुद दर्ज करें)
              </span>
              {selectedOutlet ? (
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded border border-emerald-300">
                  ✓ Google Sheet Matched
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {onOpenSyncModal && (
                <button
                  id="form-sync-full-sheet-button"
                  type="button"
                  onClick={onOpenSyncModal}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition cursor-pointer"
                  title="Sync or paste full Google Sheet outlet master"
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>Sync Full Sheet</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Searchable / Manual Outlet ID */}
            <div className="relative">
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="outlet-id-input" className="block text-xs font-bold text-slate-800">
                  Outlet ID (<span className="font-mono text-red-600">outlet_id</span>) <span className="text-rose-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setOutletSearchOpen(!outletSearchOpen)}
                  className="text-[11px] text-blue-600 hover:text-blue-800 font-medium hover:underline cursor-pointer"
                >
                  {outletSearchOpen ? 'Close Suggestions' : 'Browse Outlets'}
                </button>
              </div>

              <div className="relative">
                <input
                  id="outlet-id-input"
                  type="text"
                  value={outletIdInput}
                  onChange={(e) => {
                    setOutletIdInput(e.target.value);
                  }}
                  placeholder="Enter outlet_id (e.g. OUT12345, 10021)..."
                  className="w-full pl-9 pr-3 py-2 text-sm uppercase rounded-lg border border-slate-300 focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white font-mono font-bold text-slate-900"
                  autoComplete="off"
                  required
                />
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>

              {/* Status helper text below input */}
              <div className="mt-1 text-[11px]">
                {selectedOutlet ? (
                  <span className="text-emerald-700 font-bold flex items-center gap-1">
                    ✓ Google Sheet: {selectedOutlet.storeName} ({selectedOutlet.city})
                  </span>
                ) : outletIdInput.trim() ? (
                  <span className="text-slate-600">
                    ℹ Custom ID entered. Fields auto-fill if present in Google Sheet.
                  </span>
                ) : (
                  <span className="text-slate-400">
                    Type outlet_id to auto-show City, Store Name, Cold POC Name-2, Cold POC Contact-2.
                  </span>
                )}
              </div>

              {/* Outlet Autocomplete Dropdown (Optional Helper) */}
              {outletSearchOpen && filteredOutlets.length > 0 && (
                <div
                  id="outlet-search-dropdown"
                  className="absolute z-30 left-0 right-0 mt-1 bg-white rounded-lg shadow-xl border border-slate-200 max-h-56 overflow-y-auto"
                >
                  <div className="p-1.5 text-[11px] font-semibold text-slate-500 px-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                    <span>Master Outlets ({outlets.length} available)</span>
                    <button
                      type="button"
                      onClick={() => setOutletSearchOpen(false)}
                      className="text-slate-400 hover:text-slate-700 text-xs px-1 cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                  {filteredOutlets.map((o) => (
                    <button
                      key={o.outletId}
                      type="button"
                      onClick={() => handleSelectOutlet(o)}
                      className="w-full text-left px-3 py-2 hover:bg-red-50 flex items-center justify-between text-xs border-b border-slate-50 transition cursor-pointer"
                    >
                      <div>
                        <span className="font-mono font-bold text-slate-900">{o.outletId}</span>
                        <span className="text-slate-600 ml-2">{o.storeName}</span>
                      </div>
                      <span className="text-[11px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                        {o.city}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Store Name (Editable & Auto-filled) */}
            <div>
              <label htmlFor="master-store-name" className="block text-xs font-semibold text-slate-700 mb-1">
                Store Name {selectedOutlet && <span className="text-emerald-600 font-bold">(Auto-filled from Sheet)</span>}
              </label>
              <input
                id="master-store-name"
                type="text"
                value={storeNameInput}
                onChange={(e) => setStoreNameInput(e.target.value)}
                placeholder="Store Name..."
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white text-slate-800 font-medium"
              />
            </div>

            {/* City (Editable & Auto-filled) */}
            <div>
              <label htmlFor="master-city" className="block text-xs font-semibold text-slate-700 mb-1">
                City {selectedOutlet && <span className="text-emerald-600 font-bold">(Auto-filled from Sheet)</span>}
              </label>
              <input
                id="master-city"
                type="text"
                value={cityInput}
                onChange={(e) => setCityInput(e.target.value)}
                placeholder="City (e.g. Gurugram, Delhi)..."
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white text-slate-800 font-medium"
              />
            </div>
          </div>

          {/* Prominent Google Sheet Matched Callout Card */}
          {selectedOutlet && (
            <div
              id="google-sheet-matched-banner"
              className="bg-emerald-50 border border-emerald-300 rounded-lg p-3 text-xs text-emerald-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shadow-xs"
            >
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <div>
                  <span className="font-bold text-emerald-900 text-[13px]">
                    ✓ Google Sheet Auto-filled for {selectedOutlet.outletId}:
                  </span>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-emerald-800 mt-1">
                    <span><strong>City:</strong> {selectedOutlet.city}</span>
                    <span>•</span>
                    <span><strong>Store Name:</strong> {selectedOutlet.storeName}</span>
                    <span>•</span>
                    <span><strong>Vendor:</strong> {selectedOutlet.currentVendor || selectedOutlet.vendor}</span>
                    <span>•</span>
                    <span><strong>AMC:</strong> {selectedOutlet.amcCoverage || 'N/A'}</span>
                    <span>•</span>
                    <span><strong>Cold POC:</strong> {selectedOutlet.pocName || selectedOutlet.coldPocName2} ({selectedOutlet.pocContact || selectedOutlet.coldPocContact2})</span>
                  </div>
                </div>
              </div>
              <span className="text-[10px] bg-emerald-200 text-emerald-900 font-bold px-2 py-0.5 rounded tracking-wide shrink-0">
                GOOGLE SHEET SYNCED
              </span>
            </div>
          )}

          {/* Secondary Store & Operational Fields (Editable) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-lg border border-slate-200">
            <div>
              <label htmlFor="master-mode-input" className="block text-[11px] font-semibold text-slate-600 mb-1">
                Mode {selectedOutlet && <span className="text-emerald-600">(Auto)</span>}
              </label>
              <select
                id="master-mode-input"
                value={modeInput}
                onChange={(e) => setModeInput(e.target.value)}
                className="w-full p-1.5 text-xs rounded border border-slate-300 bg-white text-slate-800"
              >
                <option value="Dark Store">Dark Store</option>
                <option value="Hybrid Store">Hybrid Store</option>
                <option value="Retail Store">Retail Store</option>
                <option value="Warehouse">Warehouse</option>
                <option value="Distribution Center">Distribution Center</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="master-vendor-input" className="block text-[11px] font-semibold text-slate-600">
                  Vendor {selectedOutlet && <span className="text-emerald-600 font-bold">(Auto)</span>}
                </label>
                {selectedOutlet && (selectedOutlet.vendor || selectedOutlet.currentVendor) && (
                  <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1 rounded">
                    Sheet
                  </span>
                )}
              </div>
              <select
                id="master-vendor-input"
                value={vendorInput}
                onChange={(e) => setVendorInput(e.target.value)}
                className="w-full p-1.5 text-xs rounded border border-slate-300 bg-white text-slate-800 font-medium focus:ring-2 focus:ring-emerald-500"
              >
                {availableVendors.map((v) => (
                  <option key={v} value={v}>
                    {v} {selectedOutlet && (selectedOutlet.vendor === v || selectedOutlet.currentVendor === v) ? '★ (from Sheet)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="master-poc-name-input" className="block text-[11px] font-bold text-slate-800 mb-1">
                Cold POC Name-2 {selectedOutlet && <span className="text-emerald-600 font-bold">(Auto-filled)</span>}
              </label>
              <input
                id="master-poc-name-input"
                type="text"
                value={pocNameInput}
                onChange={(e) => setPocNameInput(e.target.value)}
                placeholder="Cold POC Name-2"
                className="w-full p-1.5 text-xs rounded border border-slate-300 bg-white text-slate-800 font-medium"
              />
            </div>

            <div>
              <label htmlFor="master-poc-contact-input" className="block text-[11px] font-bold text-slate-800 mb-1">
                Cold POC Contact-2 {selectedOutlet && <span className="text-emerald-600 font-bold">(Auto-filled)</span>}
              </label>
              <input
                id="master-poc-contact-input"
                type="text"
                value={pocContactInput}
                onChange={(e) => setPocContactInput(e.target.value)}
                placeholder="Cold POC Contact-2 (+91 ...)"
                className="w-full p-1.5 text-xs rounded border border-slate-300 bg-white text-slate-800 font-mono font-medium"
              />
            </div>
          </div>

          {/* AMC Coverage, Current Vendor & LOD Escalation Matrix Card (Requested by User) */}
          <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-amber-900 uppercase tracking-wide">
                  AMC Coverage & Escalation Matrix (LOD - 2 Levels)
                </span>
                {selectedOutlet && (selectedOutlet.amcCoverage || selectedOutlet.lodL1Name) && (
                  <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded border border-emerald-300">
                    ✓ Sheet Details Linked
                  </span>
                )}
              </div>
              <button
                type="button"
                id="btn-toggle-escalation-details"
                onClick={() => setShowEscalationDetails(!showEscalationDetails)}
                className="text-xs font-semibold text-amber-800 hover:text-amber-950 underline cursor-pointer"
              >
                {showEscalationDetails ? 'Collapse LOD Details' : 'Expand LOD Details'}
              </button>
            </div>

            {showEscalationDetails && (
              <div className="space-y-3 pt-1">
                {/* AMC & Current Vendor & Region Row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="amc-coverage-input" className="block text-[11px] font-semibold text-slate-700 mb-1">
                      AMC Coverage {selectedOutlet?.amcCoverage && <span className="text-emerald-600 font-bold">(Auto)</span>}
                    </label>
                    <input
                      id="amc-coverage-input"
                      type="text"
                      value={amcCoverageInput}
                      onChange={(e) => setAmcCoverageInput(e.target.value)}
                      placeholder="e.g., Comprehensive / Non-AMC"
                      className="w-full p-1.5 text-xs rounded border border-amber-300 bg-white text-slate-800"
                    />
                  </div>

                  <div>
                    <label htmlFor="current-vendor-input" className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Current Vendor (AMC or Warranty) {selectedOutlet?.currentVendor && <span className="text-emerald-600 font-bold">(Auto)</span>}
                    </label>
                    <input
                      id="current-vendor-input"
                      type="text"
                      value={currentVendorInput}
                      onChange={(e) => setCurrentVendorInput(e.target.value)}
                      placeholder="e.g., RAC / Voltas / BlueStar"
                      className="w-full p-1.5 text-xs rounded border border-amber-300 bg-white text-slate-800 font-medium"
                    />
                  </div>

                  <div>
                    <label htmlFor="region-input" className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Region (Auto)
                    </label>
                    <input
                      id="region-input"
                      type="text"
                      value={regionInput}
                      onChange={(e) => setRegionInput(e.target.value)}
                      placeholder="e.g., North / West / South"
                      className="w-full p-1.5 text-xs rounded border border-amber-300 bg-white text-slate-800"
                    />
                  </div>
                </div>

                {/* LOD - 2 Level 1 Contacts */}
                <div className="p-2.5 rounded bg-white border border-amber-200">
                  <div className="text-[11px] font-bold text-slate-800 mb-2 flex items-center justify-between">
                    <span>LOD - 2 Level 1 (L1) Escalation</span>
                    <span className="text-[10px] text-slate-500 font-normal">Primary On-Call</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label htmlFor="lod-l1-name" className="block text-[10px] text-slate-600 mb-0.5">LOD - 2 L1 Name</label>
                      <input
                        id="lod-l1-name"
                        type="text"
                        value={lodL1NameInput}
                        onChange={(e) => setLodL1NameInput(e.target.value)}
                        placeholder="L1 Contact Name"
                        className="w-full p-1 text-xs rounded border border-slate-300 bg-slate-50/50 text-slate-800"
                      />
                    </div>
                    <div>
                      <label htmlFor="lod-l1-email" className="block text-[10px] text-slate-600 mb-0.5">LOD - 2 L1 Email</label>
                      <input
                        id="lod-l1-email"
                        type="email"
                        value={lodL1EmailInput}
                        onChange={(e) => setLodL1EmailInput(e.target.value)}
                        placeholder="l1.escalation@vendor.com"
                        className="w-full p-1 text-xs rounded border border-slate-300 bg-slate-50/50 text-slate-800"
                      />
                    </div>
                    <div>
                      <label htmlFor="lod-l1-contact" className="block text-[10px] text-slate-600 mb-0.5">LOD - 2 L1 Contact No</label>
                      <input
                        id="lod-l1-contact"
                        type="text"
                        value={lodL1ContactInput}
                        onChange={(e) => setLodL1ContactInput(e.target.value)}
                        placeholder="+91 ..."
                        className="w-full p-1 text-xs rounded border border-slate-300 bg-slate-50/50 text-slate-800 font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* LOD - 2 Level 2 Contacts */}
                <div className="p-2.5 rounded bg-white border border-amber-200">
                  <div className="text-[11px] font-bold text-slate-800 mb-2 flex items-center justify-between">
                    <span>LOD - 2 Level 2 (L2) Escalation</span>
                    <span className="text-[10px] text-slate-500 font-normal">Secondary Escalation</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label htmlFor="lod-l2-name" className="block text-[10px] text-slate-600 mb-0.5">LOD - 2 L2 Name</label>
                      <input
                        id="lod-l2-name"
                        type="text"
                        value={lodL2NameInput}
                        onChange={(e) => setLodL2NameInput(e.target.value)}
                        placeholder="L2 Contact Name"
                        className="w-full p-1 text-xs rounded border border-slate-300 bg-slate-50/50 text-slate-800"
                      />
                    </div>
                    <div>
                      <label htmlFor="lod-l2-email" className="block text-[10px] text-slate-600 mb-0.5">LOD - 2 L2 Email</label>
                      <input
                        id="lod-l2-email"
                        type="email"
                        value={lodL2EmailInput}
                        onChange={(e) => setLodL2EmailInput(e.target.value)}
                        placeholder="l2.lead@vendor.com"
                        className="w-full p-1 text-xs rounded border border-slate-300 bg-slate-50/50 text-slate-800"
                      />
                    </div>
                    <div>
                      <label htmlFor="lod-l2-contact" className="block text-[10px] text-slate-600 mb-0.5">LOD - 2 L2 Contact No</label>
                      <input
                        id="lod-l2-contact"
                        type="text"
                        value={lodL2ContactInput}
                        onChange={(e) => setLodL2ContactInput(e.target.value)}
                        placeholder="+91 ..."
                        className="w-full p-1 text-xs rounded border border-slate-300 bg-slate-50/50 text-slate-800 font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* LOD - 2 Level 3 Contacts */}
                <div className="p-2.5 rounded bg-white border border-amber-200">
                  <div className="text-[11px] font-bold text-slate-800 mb-2 flex items-center justify-between">
                    <span>LOD - 2 Level 3 (L3) Escalation</span>
                    <span className="text-[10px] text-slate-500 font-normal">Executive / Head Level</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label htmlFor="lod-l3-name" className="block text-[10px] text-slate-600 mb-0.5">LOD - 2 L3 Name</label>
                      <input
                        id="lod-l3-name"
                        type="text"
                        value={lodL3NameInput}
                        onChange={(e) => setLodL3NameInput(e.target.value)}
                        placeholder="L3 Contact Name"
                        className="w-full p-1 text-xs rounded border border-slate-300 bg-slate-50/50 text-slate-800"
                      />
                    </div>
                    <div>
                      <label htmlFor="lod-l3-email" className="block text-[10px] text-slate-600 mb-0.5">LOD - 2 L3 Email</label>
                      <input
                        id="lod-l3-email"
                        type="email"
                        value={lodL3EmailInput}
                        onChange={(e) => setLodL3EmailInput(e.target.value)}
                        placeholder="l3.head@vendor.com"
                        className="w-full p-1 text-xs rounded border border-slate-300 bg-slate-50/50 text-slate-800"
                      />
                    </div>
                    <div>
                      <label htmlFor="lod-l3-contact" className="block text-[10px] text-slate-600 mb-0.5">LOD - 2 L3 Contact No.</label>
                      <input
                        id="lod-l3-contact"
                        type="text"
                        value={lodL3ContactInput}
                        onChange={(e) => setLodL3ContactInput(e.target.value)}
                        placeholder="+91 ..."
                        className="w-full p-1 text-xs rounded border border-slate-300 bg-slate-50/50 text-slate-800 font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* MST/RAC Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label htmlFor="mst-rac-name" className="block text-[10px] text-slate-600 mb-0.5">MST/RAC Name (Auto)</label>
                    <input
                      id="mst-rac-name"
                      type="text"
                      value={mstRacNameInput}
                      onChange={(e) => setMstRacNameInput(e.target.value)}
                      placeholder="MST Lead Name"
                      className="w-full p-1 text-xs rounded border border-slate-300 bg-white text-slate-800"
                    />
                  </div>
                  <div>
                    <label htmlFor="mst-rac-contact" className="block text-[10px] text-slate-600 mb-0.5">MST/RAC Contact No. (Auto)</label>
                    <input
                      id="mst-rac-contact"
                      type="text"
                      value={mstRacContactInput}
                      onChange={(e) => setMstRacContactInput(e.target.value)}
                      placeholder="+91 ..."
                      className="w-full p-1 text-xs rounded border border-slate-300 bg-white text-slate-800 font-mono"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Disruption Start Date & Time & Generated Disruption ID */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              2. Disruption Time & ID Generation
            </span>
            <span className="text-xs text-slate-400">Timezone: Asia/Kolkata (IST)</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Start Date */}
            <div>
              <label htmlFor="disruption-date" className="block text-xs font-semibold text-slate-700 mb-1">
                Disruption Start Date <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="disruption-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white"
                  required
                />
                <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            {/* Start Time */}
            <div>
              <label htmlFor="disruption-time" className="block text-xs font-semibold text-slate-700 mb-1">
                Disruption Start Time (HH:MM:SS) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="disruption-time"
                  type="text"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  placeholder="HH:MM:SS"
                  className="w-full pl-9 pr-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white"
                  required
                />
                <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            {/* Auto-Generated Disruption ID */}
            <div>
              <label htmlFor="generated-disruption-id" className="block text-xs font-semibold text-slate-700 mb-1">
                Disruption ID <span className="text-slate-400 font-normal">(Auto: OutletID-YYMMDDHHMM)</span>
              </label>
              <div className="relative">
                <input
                  id="generated-disruption-id"
                  type="text"
                  readOnly
                  value={generatedDisruptionId || 'Enter Outlet & Time above'}
                  className={`w-full pl-9 pr-3 py-2 text-xs font-mono font-bold rounded-lg border cursor-not-allowed ${
                    generatedDisruptionId
                      ? 'bg-amber-50 border-amber-300 text-amber-900'
                      : 'bg-slate-100 border-slate-200 text-slate-400'
                  }`}
                />
                <KeyRound className="w-4 h-4 text-amber-600 absolute left-3 top-2.5" />
              </div>
            </div>
          </div>
        </div>

        {/* Step 3: CC POC, Bucket, Ticket ID, Status */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              3. Operational Categorization
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* CC POC Dropdown */}
            <div>
              <label htmlFor="cc-poc-select" className="block text-xs font-semibold text-slate-700 mb-1">
                CC POC <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <select
                  id="cc-poc-select"
                  value={ccPoc}
                  onChange={(e) => setCcPoc(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-red-500 font-medium"
                  required
                >
                  {ccPocOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <UserCheck className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            {/* Bucket Dropdown */}
            <div>
              <label htmlFor="bucket-select" className="block text-xs font-semibold text-slate-700 mb-1">
                Bucket <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <select
                  id="bucket-select"
                  value={bucket}
                  onChange={(e) => setBucket(e.target.value as BucketType)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-red-500 font-medium"
                  required
                >
                  <option value="Breakdown">Breakdown</option>
                  <option value="Non Breakdown">Non Breakdown</option>
                  <option value="False Alarm / Invalid">False Alarm / Invalid</option>
                </select>
                <Tag className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            {/* Disruption Ticket ID / Nugget Ticket ID (Mandatory only when Bucket = Breakdown) */}
            <div>
              <label htmlFor="ticket-id-input" className="block text-xs font-semibold text-slate-700 mb-1">
                Disruption Ticket ID / Nugget Ticket ID
                {isTicketIdMandatory ? (
                  <span className="text-rose-500 font-bold ml-1">* (Mandatory)</span>
                ) : (
                  <span className="text-slate-400 font-normal ml-1">(Optional)</span>
                )}
              </label>
              <div className="relative">
                <input
                  id="ticket-id-input"
                  type="text"
                  value={ticketId}
                  onChange={(e) => setTicketId(e.target.value)}
                  placeholder={isTicketIdMandatory ? 'e.g. NUG-89421 (Required)' : 'e.g. NUG-89421'}
                  className={`w-full pl-9 pr-3 py-2 text-xs font-mono rounded-lg border focus:ring-2 ${
                    isTicketIdMandatory && !ticketId
                      ? 'border-amber-400 bg-amber-50/50 focus:ring-amber-500'
                      : 'border-slate-300 bg-white focus:ring-red-500'
                  }`}
                  required={isTicketIdMandatory}
                />
                <Ticket className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
              {isTicketIdMandatory && !ticketId && (
                <span className="text-[11px] text-amber-700 font-medium mt-0.5 block">
                  Disruption Ticket ID is mandatory for Breakdown.
                </span>
              )}
            </div>

            {/* Current Status */}
            <div>
              <label htmlFor="current-status-select" className="block text-xs font-semibold text-slate-700 mb-1">
                Current Status <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <select
                  id="current-status-select"
                  value={currentStatus}
                  onChange={(e) => setCurrentStatus(e.target.value as CurrentStatus)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-red-500 font-medium"
                  required
                >
                  {CURRENT_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <Activity className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>
          </div>

          {/* Conditional Issue & Sub-Issue Fields (Visible only for resolved statuses) */}
          {isIssueMandatory && (
            <div
              id="conditional-issue-section"
              className="p-4 rounded-lg bg-emerald-50/80 border border-emerald-200 grid grid-cols-1 md:grid-cols-2 gap-4"
            >
              <div>
                <label htmlFor="issue-select" className="block text-xs font-semibold text-emerald-900 mb-1">
                  Issue Category <span className="text-rose-500">* (Mandatory for {currentStatus})</span>
                </label>
                <select
                  id="issue-select"
                  value={selectedIssue}
                  onChange={(e) => handleIssueChange(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-emerald-300 bg-white focus:ring-2 focus:ring-emerald-500 font-medium"
                  required
                >
                  <option value="">Select Issue Category</option>
                  {Object.keys(issueMaster).map((issueKey) => (
                    <option key={issueKey} value={issueKey}>
                      {issueKey}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="sub-issue-select" className="block text-xs font-semibold text-emerald-900 mb-1">
                  Sub Issue <span className="text-rose-500">* (Mandatory)</span>
                </label>
                <select
                  id="sub-issue-select"
                  value={selectedSubIssue}
                  onChange={(e) => setSelectedSubIssue(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-emerald-300 bg-white focus:ring-2 focus:ring-emerald-500 font-medium"
                  required
                >
                  <option value="">Select Sub Issue</option>
                  {availableSubIssues.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Step 4: Live Update */}
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <label htmlFor="live-update-textarea" className="text-xs font-bold uppercase tracking-wider text-slate-500">
              4. Operational Live Update <span className="text-rose-500">*</span>
            </label>
            <span className="text-xs text-slate-400">Timestamped running history log</span>
          </div>

          <div className="relative">
            <textarea
              id="live-update-textarea"
              rows={3}
              value={liveUpdateText}
              onChange={(e) => setLiveUpdateText(e.target.value)}
              placeholder="Enter real-time incident update (e.g. RAC aligned, technician Rajesh assigned, ETA 45 mins...)"
              className="w-full p-3 text-xs rounded-lg border border-slate-300 focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white"
              required
            />
            <MessageSquare className="w-4 h-4 text-slate-400 absolute right-3 bottom-3" />
          </div>
        </div>

        {/* Step 5: First response times - feed the AVG CC/MST FRT report tiles */}
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              5. First Response Time
            </span>
            <span className="text-xs text-slate-400">Optional - leave blank if not known yet</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="cc-frt-input" className="block text-xs font-semibold text-slate-700 mb-1">
                CC FRT (minutes)
              </label>
              <input
                id="cc-frt-input"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={ccFrtInput}
                onChange={(e) => setCcFrtInput(e.target.value)}
                placeholder="e.g. 3"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white font-mono"
              />
            </div>
            <div>
              <label htmlFor="mst-frt-input" className="block text-xs font-semibold text-slate-700 mb-1">
                MST / RAC FRT (minutes)
              </label>
              <input
                id="mst-frt-input"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={mstFrtInput}
                onChange={(e) => setMstFrtInput(e.target.value)}
                placeholder="e.g. 25"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:ring-2 focus:ring-red-500 focus:border-red-500 bg-white font-mono"
              />
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <div className="pt-2 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Recorded By: <span className="font-semibold text-slate-700">{currentUser || ccPoc}</span>
          </p>

          <button
            id="create-disruption-submit-button"
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm shadow-md transition active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <PlusCircle className="w-4 h-4" />
            <span>{isSubmitting ? 'CREATING DISRUPTION...' : 'CREATE DISRUPTION'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
