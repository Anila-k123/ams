import { useRef } from 'react';
import { Button } from 'primereact/button';
import { useDashboardFilter } from '../contexts/DashboardFilterContext';

export default function DashboardTimeNavigator() {
  const { periodLabel, navigatePrev, navigateNext, isNextDisabled, view, currentDate, setCurrentDate } =
    useDashboardFilter() as any;
  const pickerRef = useRef<HTMLInputElement>(null);

  const handlePickerChange = (e: any) => {
    const val = e.target.value;
    if (!val) return;
    const d = new Date(val);
    if (!isNaN(d.getTime())) setCurrentDate(d);
  };

  const handlePrev = () => { pickerRef.current?.blur(); navigatePrev(); };
  const handleNext = () => { pickerRef.current?.blur(); navigateNext(); };

  const getPickerType = () => (view === 'month' ? 'month' : view === 'year' ? 'number' : 'date');

  const getPickerValue = () => {
    const d = currentDate;
    if (view === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (view === 'year') return d.getFullYear().toString();
    return d.toISOString().split('T')[0];
  };

  const getPickerMin = () => {
    // Minimum: 5 years ago
    const d = new Date(currentDate);
    d.setFullYear(d.getFullYear() - 5);
    return view === 'year' ? d.getFullYear().toString() : d.toISOString().split('T')[0];
  };

  const getPickerMax = () => {
    const now = new Date();
    if (view === 'year') return now.getFullYear().toString();
    return now.toISOString().split('T')[0];
  };

  return (
    <div className="time-navigator flex align-items-center gap-1">
      <Button icon="pi pi-chevron-left" text rounded size="small" onClick={handlePrev} tooltip="Previous" />
      <div className="period-label-wrapper">
        <span className="period-label">{periodLabel()}</span>
        {/* Native picker overlays the label (month/year inputs have no PrimeReact twin with the same semantics). */}
        <input
          ref={pickerRef}
          type={getPickerType()}
          className="period-picker"
          value={getPickerValue()}
          onChange={handlePickerChange}
          min={getPickerMin()}
          max={getPickerMax()}
        />
      </div>
      <Button icon="pi pi-chevron-right" text rounded size="small" onClick={handleNext} disabled={isNextDisabled} tooltip="Next" />
    </div>
  );
}
