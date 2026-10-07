/* ==========================================================================
   SAMPLE DATA — Kumar & Associates, Chennai (Tamil Nadu jurisdiction)
   All dates are relative to the day the demo is opened, so "today" always
   has hearings on it. Terminology mirrors the real PactPro codebase.
   ========================================================================== */
const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
const day = (offset, h = 0, m = 0) => { const d = new Date(TODAY); d.setDate(d.getDate() + offset); d.setHours(h, m, 0, 0); return d; };

const D = {};

D.firm = {
  name: 'Kumar & Associates', short: 'K&A',
  address: 'No. 14, Second Line Beach Road, Parrys, Chennai 600001',
  phone: '+91 44 2534 7781', email: 'office@kumar-associates.demo',
  gstin: '33AAKFK4471M1ZQ', pan: 'AAKFK4471M',
  bank: { favour: 'KUMAR & ASSOCIATES', name: 'HDFC BANK LTD.', branch: 'Anna Salai, Chennai - 600002', account: '50200041178823', ifsc: 'HDFC0000032', micr: '600240004', hsn: '998212', category: 'LEGAL SERVICES' },
};

D.advocates = [
  { id: 1, name: 'Rajesh Kumar', role: 'Senior Advocate', email: 'rajesh@kumar-associates.demo', phone: '+91 98400 11201', bar: 'MS/1123/2001', head: true, since: '2001' },
  { id: 2, name: 'Arjun Menon', role: 'Senior Advocate', email: 'arjun@kumar-associates.demo', phone: '+91 98400 22417', bar: 'MS/2874/2008', reportsTo: null, since: '2008' },
  { id: 3, name: 'Priya Nair', role: 'Junior Advocate', email: 'priya@kumar-associates.demo', phone: '+91 98844 31092', bar: 'MS/5521/2019', reportsTo: 1, since: '2019' },
  { id: 4, name: 'Karthik R.', role: 'Intern', email: 'karthik@kumar-associates.demo', phone: '+91 90031 77810', bar: '—', reportsTo: 3, since: '2026' },
  { id: 5, name: 'Lakshmi S.', role: 'Receptionist', email: 'lakshmi@kumar-associates.demo', phone: '+91 90030 55102', bar: '—', since: '2015' },
  { id: 6, name: 'Suresh Kumar', role: 'Accountant', email: 'suresh@kumar-associates.demo', phone: '+91 94440 66310', bar: '—', since: '2012' },
  { id: 7, name: 'Meena Iyer', role: 'Super Admin', email: 'meena@kumar-associates.demo', phone: '+91 94441 72019', bar: '—', since: '2018' },
];
D.me = D.advocates[0];

D.clients = [
  { id: 1, name: 'Kannan', kind: 'Individual', phone: '+91 90030 11900', email: 'kannan.m@gmail.com', building: 'No. 7', street: 'Kamarajar Salai, Mylapore', city: 'Chennai', district: 'Chennai', pin: '600004', gstin: '', advocate: 1, since: day(-210), portal: true, note: 'Landlord. Eviction suit against tenant Seetharaman.' },
  { id: 2, name: 'R. Murugan', kind: 'Individual', phone: '+91 94440 00700', email: 'murugan.r@yahoo.co.in', building: 'No. 3', street: 'Gandhi Street, Tambaram', city: 'Chengalpattu', district: 'Chengalpattu', pin: '600045', gstin: '', advocate: 2, since: day(-400), portal: true, note: 'First appeal against decree in O.S. 101/2020.' },
  { id: 3, name: 'K. M. Anand Joshi', kind: 'Individual', phone: '+91 98410 22033', email: 'anand.joshi@clients.demo', building: 'Flat 4B, Ceebros Gardens', street: 'Arumbakkam', city: 'Chennai', district: 'Chennai', pin: '600106', gstin: '', advocate: 1, since: day(-640), portal: true, note: '' },
  { id: 4, name: 'M/s. Akshayam Traders', kind: 'Company', phone: '+91 44 2522 4410', email: 'accounts@akshayamtraders.in', building: 'No. 112', street: 'Godown Street, Sowcarpet', city: 'Chennai', district: 'Chennai', pin: '600079', gstin: '33AAQFA2210K1Z4', advocate: 2, since: day(-300), portal: false, note: 'Commercial recovery matters.' },
  { id: 5, name: 'HCL Technologies Ltd.', kind: 'Company', phone: '+91 44 6638 0000', email: 'legal.chennai@hcl.demo', building: 'Elcot SEZ', street: 'Sholinganallur', city: 'Chennai', district: 'Chennai', pin: '600119', gstin: '33AAACH1645P1ZW', advocate: 1, since: day(-900), portal: false, note: 'Retainer. Labour and service matters.' },
  { id: 6, name: 'Selvi Ramasamy', kind: 'Individual', phone: '+91 97890 41120', email: 'selvi.r@gmail.com', building: 'No. 22', street: 'Bharathi Nagar, T. Nagar', city: 'Chennai', district: 'Chennai', pin: '600017', gstin: '', advocate: 3, since: day(-12), portal: false, note: 'Walk-in. Maintenance petition.' },
  { id: 7, name: 'Ravinder Singh Chaddha', kind: 'Individual', phone: '+91 98111 40926', email: 'rs.chaddha@outlook.com', building: 'No. 5', street: 'Harrington Road, Chetpet', city: 'Chennai', district: 'Chennai', pin: '600031', gstin: '', advocate: 2, since: day(-500), portal: true, note: '' },
  { id: 8, name: 'Mohabul Shaikh & Ors.', kind: 'Individual', phone: '+91 90950 88213', email: 'm.shaikh@gmail.com', building: 'No. 48', street: 'Big Street, Triplicane', city: 'Chennai', district: 'Chennai', pin: '600005', gstin: '', advocate: 3, since: day(-180), portal: false, note: '' },
  { id: 9, name: 'Shashidhar Reddy Beeravolu', kind: 'Individual', phone: '+91 99620 11847', email: 'shashidhar.b@gmail.com', building: 'Plot 9', street: 'Velachery Main Road', city: 'Chennai', district: 'Chennai', pin: '600042', gstin: '', advocate: 1, since: day(-260), portal: true, note: 'Writ against TNEB demand.' },
  { id: 10, name: 'Mathankumar', kind: 'Individual', phone: '+91 95000 36621', email: 'mathan.k@gmail.com', building: 'No. 3/14', street: 'Anna Nagar West', city: 'Madurai', district: 'Madurai', pin: '625020', gstin: '', advocate: 2, since: day(-150), portal: false, note: 'Madurai Bench matter.' },
  { id: 11, name: 'Sri Lakshmi Textiles Pvt. Ltd.', kind: 'Company', phone: '+91 422 254 1180', email: 'legal@srilakshmitex.in', building: 'No. 77', street: 'Avinashi Road', city: 'Coimbatore', district: 'Coimbatore', pin: '641018', gstin: '33AAICS9021Q1Z2', advocate: 1, since: day(-720), portal: false, note: '' },
  { id: 12, name: 'Dr. V. Padmavathi', kind: 'Individual', phone: '+91 98400 55219', email: 'padma.v@gmail.com', building: 'No. 2', street: 'Luz Church Road, Mylapore', city: 'Chennai', district: 'Chennai', pin: '600004', gstin: '', advocate: 3, since: day(-90), portal: true, note: 'Consumer complaint against hospital supplier.' },
  { id: 13, name: 'Tamilarasan & Sons', kind: 'Company', phone: '+91 44 2621 0098', email: 'tsons@gmail.com', building: 'No. 31', street: 'Ponnamallee High Road, Kilpauk', city: 'Chennai', district: 'Chennai', pin: '600010', gstin: '33AAEFT7741B1Z8', advocate: 2, since: day(-330), portal: false, note: '' },
  { id: 14, name: 'S. Geetha', kind: 'Individual', phone: '+91 93810 70442', email: 'geetha.s@gmail.com', building: 'No. 8', street: 'Lake View Road, West Mambalam', city: 'Chennai', district: 'Chennai', pin: '600033', gstin: '', advocate: 3, since: day(-45), portal: false, note: '' },
  { id: 15, name: 'Coromandel Builders LLP', kind: 'Company', phone: '+91 44 4211 9900', email: 'legal@coromandelbuilders.in', building: 'No. 201', street: 'Mount Road, Teynampet', city: 'Chennai', district: 'Chennai', pin: '600018', gstin: '33AAMFC5512H1ZK', advocate: 1, since: day(-560), portal: false, note: 'RERA and arbitration.' },
  { id: 16, name: 'A. Joseph Raj', kind: 'Individual', phone: '+91 97100 23345', email: 'josephraj.a@gmail.com', building: 'No. 15', street: 'Church Street, Tirunelveli Town', city: 'Tirunelveli', district: 'Tirunelveli', pin: '627006', gstin: '', advocate: 2, since: day(-75), portal: false, note: '', archived: true },
];

/* Courts as they appear in the court-record import */
D.courts = [
  { id: 'mhc', name: 'Madras High Court', level: 'High Court', bench: 'Principal Bench, Chennai' },
  { id: 'mhc-md', name: 'Madras High Court', level: 'High Court', bench: 'Madurai Bench' },
  { id: 'ccc', name: 'City Civil Court, Chennai', level: 'District', bench: 'City Civil Court Complex, Chennai' },
  { id: 'cmm', name: 'Chief Metropolitan Magistrate, Egmore', level: 'District', bench: 'Egmore, Chennai' },
  { id: 'fam', name: 'Family Court, Chennai', level: 'District', bench: 'City Civil Court Complex, Chennai' },
  { id: 'dc-cbe', name: 'Principal District Court, Coimbatore', level: 'District', bench: 'Coimbatore' },
  { id: 'sci', name: 'Supreme Court of India', level: 'Supreme Court', bench: 'New Delhi' },
];

/* nh = next hearing offset in days (null = none); h = hour */
const C = (o) => o;
D.cases = [
  C({ id: 1, no: 'O.S. No. 900/2025', type: 'Original Suit', court: 'ccc', hall: 'Court No. VI', judge: 'Thiru. S. Ravichandran, VI Asst. Judge', title: 'Kannan vs Seetharaman', client: 1, adv: 1, status: 'Active', stage: 'Evidence', nh: 0, h: 10, m: 30, cnr: 'TNCH010015532025', filed: day(-200), tags: ['High Priority', 'For Argument'], fee: 120000, paid: 60000, opp: 'M. Venugopal', item: 14, desc: 'Suit for recovery of possession, arrears of rent Rs. 3,15,000 and mesne profits.' }),
  C({ id: 2, no: 'A.S. No. 700/2025', type: 'First Appeal', court: 'mhc', hall: 'Court Hall 12', judge: 'Hon\'ble Mr. Justice N. Seshasayee', title: 'R. Murugan vs K. Rathinavel', client: 2, adv: 2, status: 'Active', stage: 'Arguments', nh: 0, h: 11, m: 0, cnr: 'HCMA011266642024', filed: day(-380), tags: ['For Argument'], fee: 250000, paid: 150000, opp: 'M/s. Jeremiah Gregory John', item: 37, desc: 'First appeal under Sec. 96 CPC against decree in O.S. 101/2020.' }),
  C({ id: 3, no: 'W.P. No. 14600/2026', type: 'Writ Petition', court: 'mhc', hall: 'Court Hall 4', judge: 'Hon\'ble Mrs. Justice R. Hemalatha', title: 'Shashidhar Reddy Beeravolu vs TANGEDCO', client: 9, adv: 1, status: 'Active', stage: 'For Counter/Reply', nh: 0, h: 14, m: 15, cnr: 'HCMA010442112026', filed: day(-60), tags: ['Urgent'], fee: 80000, paid: 80000, opp: 'Standing Counsel, TANGEDCO', item: 52, desc: 'Writ of certiorari quashing supplementary demand of Rs. 4,82,000.' }),
  C({ id: 4, no: 'O.S. No. 150/2025', type: 'Original Suit', court: 'ccc', hall: 'Court No. II', judge: 'Thiru. A. Mohammed Jaffar, II Addl. Judge', title: 'K. M. Anand Joshi vs The Malayalee Club', client: 3, adv: 1, status: 'Active', stage: 'Cross-examination', nh: 1, h: 10, m: 30, cnr: 'TNCH010004212025', filed: day(-320), tags: ['Follow Up'], fee: 150000, paid: 90000, opp: 'N. Manoharan', item: 8, desc: 'Declaration and permanent injunction regarding membership rights.' }),
  C({ id: 5, no: 'C.M.A. No. 1200/2025', type: 'Civil Misc. Appeal', court: 'mhc', hall: 'Court Hall 9', judge: 'Hon\'ble Mr. Justice C. Saravanan', title: 'Coromandel Builders LLP vs Union of India', client: 15, adv: 1, status: 'Pending', stage: 'Admission', nh: 2, h: 10, m: 30, cnr: 'HCMA011902252025', filed: day(-150), tags: ['Reserved'], fee: 300000, paid: 120000, opp: 'Additional Solicitor General', item: 21, desc: 'Appeal against order in arbitration petition under Sec. 37 of the Arbitration and Conciliation Act, 1996.' }),
  C({ id: 6, no: 'SLP(C) No. 12710/2026', type: 'Special Leave Petition', court: 'sci', hall: 'Court No. 5', judge: 'Hon\'ble Justice B. V. Nagarathna', title: 'HCL Technologies Ltd. vs S. Prabhakaran', client: 5, adv: 2, status: 'Pending', stage: 'Mention', nh: 6, h: 10, m: 30, cnr: 'SCIN010127102026', filed: day(-40), tags: ['Important'], fee: 450000, paid: 200000, opp: 'Mr. P. Wilson, Sr. Adv.', item: 61, desc: 'SLP against Division Bench judgment in W.A. No. 2211/2025.' }),
  C({ id: 7, no: 'C.A. No. 5640/2026', type: 'Civil Appeal', court: 'sci', hall: 'Court No. 3', judge: 'Hon\'ble Justice Sanjiv Khanna', title: 'Sri Lakshmi Textiles Pvt. Ltd. vs Commissioner of GST', client: 11, adv: 1, status: 'Active', stage: 'Arguments', nh: 13, h: 10, m: 30, cnr: 'SCIN010564012026', filed: day(-190), tags: ['High Priority'], fee: 600000, paid: 450000, opp: 'Additional Solicitor General', item: 12, desc: 'Civil appeal on input tax credit reversal.' }),
  C({ id: 8, no: 'O.S. No. 412/2023', type: 'Original Suit', court: 'ccc', hall: 'Court No. XV', judge: 'Tmt. K. Shanthi, XV Asst. Judge', title: 'M/s. Akshayam Traders vs Tamilarasan & Sons', client: 4, adv: 2, status: 'Active', stage: 'Framing of Issues', nh: 3, h: 11, m: 0, cnr: 'TNCH010041232023', filed: day(-980), tags: [], fee: 90000, paid: 45000, opp: 'R. Balasubramanian', item: 33, desc: 'Recovery of Rs. 8,40,000 towards supply of goods.' }),
  C({ id: 9, no: 'M.C. No. 88/2026', type: 'Maintenance Case', court: 'fam', hall: 'I Addl. Family Court', judge: 'Tmt. G. Saraswathi', title: 'Selvi Ramasamy vs R. Ramasamy', client: 6, adv: 3, status: 'Active', stage: 'Mediation', nh: 4, h: 15, m: 0, cnr: 'TNCH130008812026', filed: day(-10), tags: ['Follow Up'], fee: 30000, paid: 10000, opp: '—', item: 4, desc: 'Petition under Sec. 144 BNSS for maintenance.' }),
  C({ id: 10, no: 'C.C. No. 2231/2025', type: 'Calendar Case', court: 'cmm', hall: 'XIV MM Court', judge: 'Thiru. P. Senthil Kumar, XIV MM', title: 'M/s. Akshayam Traders vs V. Durairaj', client: 4, adv: 3, status: 'Active', stage: 'Evidence', nh: 8, h: 10, m: 0, cnr: 'TNCH200223112025', filed: day(-280), tags: [], fee: 45000, paid: 30000, opp: 'K. Ilango', item: 41, desc: 'Complaint under Sec. 138 Negotiable Instruments Act, 1881. Cheque for Rs. 2,75,000.' }),
  C({ id: 11, no: 'W.P.(MD) No. 9921/2026', type: 'Writ Petition', court: 'mhc-md', hall: 'Court Hall 2', judge: 'Hon\'ble Mr. Justice G. R. Swaminathan', title: 'Mathankumar vs District Collector, Madurai', client: 10, adv: 2, status: 'Pending', stage: 'Admission', nh: 9, h: 10, m: 30, cnr: 'HCMD010992112026', filed: day(-30), tags: ['Awaiting Documents'], fee: 60000, paid: 20000, opp: 'Government Pleader', item: 18, desc: 'Writ of mandamus for patta transfer.' }),
  C({ id: 12, no: 'C.S. No. 344/2024', type: 'Civil Suit (Original Side)', court: 'mhc', hall: 'Court Hall 21', judge: 'Hon\'ble Mr. Justice Abdul Quddhose', title: 'Coromandel Builders LLP vs Sterling Infra Projects', client: 15, adv: 1, status: 'Active', stage: 'Evidence', nh: 15, h: 14, m: 15, cnr: 'HCMA020344112024', filed: day(-700), tags: [], fee: 500000, paid: 380000, opp: 'Mr. Satish Parasaran, Sr. Adv.', item: 7, desc: 'Suit for damages and specific performance of joint development agreement.' }),
  C({ id: 13, no: 'C.C. No. 41/2026', type: 'Consumer Complaint', court: 'ccc', hall: 'DCDRC, Chennai (North)', judge: 'President, DCDRC', title: 'Dr. V. Padmavathi vs MedSure Equipments', client: 12, adv: 3, status: 'Active', stage: 'For Counter/Reply', nh: 11, h: 11, m: 0, cnr: 'TNCH400004112026', filed: day(-70), tags: [], fee: 40000, paid: 40000, opp: '—', item: 9, desc: 'Deficiency in service, defective ventilator supplied.' }),
  C({ id: 14, no: 'Crl.O.P. No. 18822/2026', type: 'Criminal Original Petition', court: 'mhc', hall: 'Court Hall 33', judge: 'Hon\'ble Mr. Justice A. D. Jagadish Chandira', title: 'Ravinder Singh Chaddha vs State rep. by Inspector of Police', client: 7, adv: 2, status: 'Active', stage: 'For Orders', nh: 1, h: 14, m: 15, cnr: 'HCMA030188222026', filed: day(-25), tags: ['Urgent', 'For Orders'], fee: 75000, paid: 75000, opp: 'Govt. Advocate (Crl. Side)', item: 66, desc: 'Petition under Sec. 528 BNSS to quash FIR No. 311/2026.' }),
  C({ id: 15, no: 'O.S. No. 1771/2024', type: 'Original Suit', court: 'ccc', hall: 'Court No. IX', judge: 'Thiru. M. Kannan, IX Asst. Judge', title: 'Mohabul Shaikh & Ors. vs Chennai Corporation', client: 8, adv: 3, status: 'Active', stage: 'Evidence', nh: 20, h: 10, m: 30, cnr: 'TNCH010177142024', filed: day(-480), tags: [], fee: 50000, paid: 25000, opp: 'Corporation Counsel', item: 26, desc: 'Suit for permanent injunction against demolition.' }),
  C({ id: 16, no: 'A.S. No. 212/2024', type: 'First Appeal', court: 'mhc', hall: 'Court Hall 12', judge: 'Hon\'ble Mr. Justice N. Seshasayee', title: 'Tamilarasan & Sons vs Indian Overseas Bank', client: 13, adv: 2, status: 'Pending', stage: 'For Orders', nh: null, cnr: 'HCMA011021242024', filed: day(-620), tags: ['Reserved'], fee: 180000, paid: 180000, opp: 'Standing Counsel, IOB', item: null, desc: 'Judgment reserved.' }),
  C({ id: 17, no: 'O.S. No. 59/2022', type: 'Original Suit', court: 'dc-cbe', hall: 'Principal District Court', judge: 'Thiru. R. Selvakumar, Prl. District Judge', title: 'Sri Lakshmi Textiles Pvt. Ltd. vs Ganesh Mills', client: 11, adv: 1, status: 'Closed', stage: 'Disposed', nh: null, cnr: 'TNCB000005922022', filed: day(-1300), tags: [], fee: 220000, paid: 220000, opp: 'S. Natarajan', item: null, desc: 'Decreed in favour of plaintiff on ' + '12.06.2026.' }),
  C({ id: 18, no: 'H.M.O.P. No. 610/2025', type: 'Hindu Marriage O.P.', court: 'fam', hall: 'II Addl. Family Court', judge: 'Tmt. L. Abirami', title: 'S. Geetha vs K. Suresh', client: 14, adv: 3, status: 'Active', stage: 'Mediation', nh: 5, h: 11, m: 30, cnr: 'TNCH130061022025', filed: day(-210), tags: ['On Hold'], fee: 60000, paid: 35000, opp: 'V. Rekha', item: 15, desc: 'Petition for divorce by mutual consent; cooling-off period running.' }),
  C({ id: 19, no: 'O.S. No. 101/2020', type: 'Original Suit', court: 'ccc', hall: 'Court No. IV', judge: 'Thiru. K. Rajasekar', title: 'K. Rathinavel vs R. Murugan', client: 2, adv: 2, status: 'Closed', stage: 'Disposed', nh: null, cnr: 'TNCH010010122020', filed: day(-2100), tags: ['Appeal'], fee: 100000, paid: 100000, opp: 'M/s. Jeremiah Gregory John', item: null, desc: 'Decreed against our client. Appeal filed as A.S. No. 700/2025.' }),
  C({ id: 20, no: 'W.A. No. 2211/2025', type: 'Writ Appeal', court: 'mhc', hall: 'First Bench', judge: 'Hon\'ble the Chief Justice and Hon\'ble Mr. Justice D. Bharatha Chakravarthy', title: 'HCL Technologies Ltd. vs S. Prabhakaran', client: 5, adv: 2, status: 'Closed', stage: 'Disposed', nh: null, cnr: 'HCMA040221122025', filed: day(-400), tags: ['Appeal'], fee: 300000, paid: 300000, opp: 'Mr. P. Wilson, Sr. Adv.', item: null, desc: 'Dismissed. SLP filed.' }),
  C({ id: 21, no: 'Arb. O.P. No. 77/2026', type: 'Arbitration O.P.', court: 'mhc', hall: 'Court Hall 21', judge: 'Hon\'ble Mr. Justice Abdul Quddhose', title: 'Coromandel Builders LLP vs Harbour View Residents Assn.', client: 15, adv: 1, status: 'Active', stage: 'Arguments', nh: 7, h: 14, m: 15, cnr: 'HCMA050007712026', filed: day(-90), tags: ['For Argument'], fee: 350000, paid: 175000, opp: 'Mr. AR. L. Sundaresan, Sr. Adv.', item: 3, desc: 'Petition under Sec. 34 to set aside the arbitral award dated 02.03.2026.' }),
  C({ id: 22, no: 'R.C.O.P. No. 1402/2025', type: 'Rent Control O.P.', court: 'ccc', hall: 'XII Small Causes Court', judge: 'Thiru. J. Pandian, XII Judge', title: 'Kannan vs Seetharaman', client: 1, adv: 3, status: 'Active', stage: 'Evidence', nh: 10, h: 10, m: 30, cnr: 'TNCH050140222025', filed: day(-250), tags: ['Connected'], fee: 40000, paid: 20000, opp: 'M. Venugopal', item: 19, desc: 'Eviction under Sec. 21 of the TN Regulation of Rights and Responsibilities of Landlords and Tenants Act, 2017.' }),
  C({ id: 23, no: 'Crl.A. No. 455/2026', type: 'Criminal Appeal', court: 'mhc', hall: 'Court Hall 37', judge: 'Hon\'ble Mr. Justice P. Velmurugan', title: 'A. Joseph Raj vs State', client: 16, adv: 2, status: 'Pending', stage: 'Admission', nh: 18, h: 10, m: 30, cnr: 'HCMA030455212026', filed: day(-20), tags: [], fee: 65000, paid: 0, opp: 'Additional Public Prosecutor', item: 44, desc: 'Appeal against conviction under Sec. 318 BNS.' }),
  C({ id: 24, no: 'E.P. No. 210/2026', type: 'Execution Petition', court: 'dc-cbe', hall: 'Principal District Court', judge: 'Thiru. R. Selvakumar, Prl. District Judge', title: 'Sri Lakshmi Textiles Pvt. Ltd. vs Ganesh Mills', client: 11, adv: 1, status: 'Active', stage: 'Notice', nh: 12, h: 11, m: 0, cnr: 'TNCB000021012026', filed: day(-55), tags: [], fee: 60000, paid: 30000, opp: 'S. Natarajan', item: 11, desc: 'Execution of decree in O.S. No. 59/2022.' }),
  C({ id: 25, no: 'C.R.P. No. 3301/2025', type: 'Civil Revision Petition', court: 'mhc', hall: 'Court Hall 15', judge: 'Hon\'ble Mr. Justice V. Lakshminarayanan', title: 'K. M. Anand Joshi vs The Malayalee Club', client: 3, adv: 1, status: 'Closed', stage: 'Disposed', nh: null, cnr: 'HCMA010330122025', filed: day(-260), tags: [], fee: 70000, paid: 70000, opp: 'N. Manoharan', item: null, desc: 'Allowed. Interim injunction restored.' }),
  C({ id: 26, no: 'O.S. No. 2290/2026', type: 'Original Suit', court: 'ccc', hall: 'Court No. VI', judge: 'Thiru. S. Ravichandran, VI Asst. Judge', title: 'Tamilarasan & Sons vs Metro Water Board', client: 13, adv: 3, status: 'Pending', stage: 'Notice', nh: 22, h: 10, m: 30, cnr: 'TNCH010229022026', filed: day(-8), tags: ['Awaiting Documents'], fee: 70000, paid: 0, opp: '—', item: 29, desc: 'Suit for refund of excess water charges.' }),
  C({ id: 27, no: 'I.A. No. 1/2025 in O.S. No. 900/2025', type: 'Interlocutory Application', court: 'ccc', hall: 'Court No. VI', judge: 'Thiru. S. Ravichandran, VI Asst. Judge', title: 'Kannan vs Seetharaman', client: 1, adv: 3, status: 'Active', stage: 'For Orders', nh: 0, h: 10, m: 30, cnr: 'TNCH010015532025', filed: day(-190), tags: ['For Orders'], fee: 15000, paid: 15000, opp: 'M. Venugopal', item: 15, desc: 'Application for deposit of arrears of rent pending suit.' }),
  C({ id: 28, no: 'W.P. No. 20114/2026', type: 'Writ Petition', court: 'mhc', hall: 'Court Hall 6', judge: 'Hon\'ble Mr. Justice S. M. Subramaniam', title: 'Dr. V. Padmavathi vs Tamil Nadu Medical Council', client: 12, adv: 1, status: 'Pending', stage: 'Admission', nh: 27, h: 10, m: 30, cnr: 'HCMA010201142026', filed: day(-5), tags: [], fee: 85000, paid: 0, opp: 'Standing Counsel, TNMC', item: 58, desc: 'Writ against suspension of registration.' }),
];
D.cases.forEach(c => {
  const ct = D.courts.find(x => x.id === c.court);
  c.courtName = ct.name; c.level = ct.level; c.bench = ct.bench;
  c.next = c.nh == null ? null : day(c.nh, c.h, c.m);
  c.party = c.title.split(' vs ');
});

D.hearingPurposes = ['Arguments', 'Evidence', 'Framing of Issues', 'For Counter/Reply', 'For Orders', 'Interim Application', 'Mention', 'Cross-examination', 'Other'];

/* Calendar events: one per scheduled case hearing, plus meetings, payment dues, filings */
D.events = [];
let evId = 1;
D.cases.filter(c => c.next).forEach(c => D.events.push({ id: evId++, type: 'Hearing', title: c.no, caseId: c.id, at: c.next, purpose: c.stage, court: c.courtName, hall: c.hall, judge: c.judge }));
[
  [0, 17, 30, 'Client Meeting', 'Conference with Kannan, witness preparation', 1],
  [1, 16, 0, 'Client Meeting', 'Akshayam Traders, ledger walkthrough', 8],
  [2, 12, 0, 'Document Filing', 'File counter affidavit, W.P. 14600/2026', 3],
  [3, 18, 0, 'Payment Due', 'Fee instalment due, Coromandel Builders', 5],
  [5, 15, 30, 'Client Meeting', 'Selvi Ramasamy, mediation brief', 9],
  [6, 11, 0, 'Document Filing', 'Typed set of papers, SLP(C) 12710/2026', 6],
  [9, 17, 0, 'Payment Due', 'Invoice KA/2026-27/0041 due, HCL', 6],
  [12, 16, 0, 'Client Meeting', 'Sri Lakshmi Textiles board briefing', 7],
  [-1, 10, 30, 'Hearing', 'O.S. No. 412/2023', 8],
  [-2, 14, 15, 'Hearing', 'C.M.A. No. 1200/2025', 5],
  [-6, 10, 30, 'Hearing', 'O.S. No. 900/2025', 1],
  [-8, 11, 0, 'Client Meeting', 'Dr. Padmavathi, complaint review', 13],
  [16, 12, 0, 'Document Filing', 'Written statement, O.S. 2290/2026', 26],
  [19, 15, 0, 'Client Meeting', 'Joseph Raj, appeal strategy', 23],
].forEach(([o, h, m, type, title, caseId]) => {
  const c = D.cases.find(x => x.id === caseId);
  D.events.push({ id: evId++, type, title, caseId, at: day(o, h, m), purpose: type === 'Hearing' ? 'Arguments' : '', court: c.courtName, hall: c.hall, judge: c.judge, past: o < 0 });
});

/* Hearing history per case (court record style) */
D.hearingHistory = (caseId) => {
  const c = D.cases.find(x => x.id === caseId); if (!c) return [];
  const purposes = ['Notice', 'Appearance', 'Framing of Issues', 'Evidence', 'Cross-examination', 'Evidence', 'Arguments'];
  const out = []; const n = 4 + (caseId % 4);
  for (let i = n; i >= 1; i--) {
    out.push({ date: day(-i * 21 - (caseId % 5)), purpose: purposes[(n - i) % purposes.length], judge: c.judge, outcome: i === 1 ? 'Adjourned at request of respondent' : (i % 2 ? 'Witness PW1 examined in part' : 'Adjourned for ' + purposes[(n - i + 1) % purposes.length].toLowerCase()), item: 10 + ((caseId * i) % 50) });
  }
  return out;
};

D.parties = (c) => {
  const [a, b] = c.party;
  const roles = c.type.includes('Appeal') || c.type.includes('Appeal') ? ['Appellant', 'Respondent'] : c.type.includes('Writ') || c.type.includes('O.P') || c.type.includes('Petition') ? ['Petitioner', 'Respondent'] : c.type.includes('Calendar') ? ['Complainant', 'Accused'] : ['Plaintiff', 'Defendant'];
  return [
    { name: a, role: roles[0], counsel: D.advocates.find(x => x.id === c.adv).name, ours: true },
    { name: b, role: roles[1], counsel: c.opp, ours: false },
  ];
};

/* Invoices: GST at 18%, CGST+SGST within Tamil Nadu */
const inv = (n, caseId, dOff, dueOff, items, status) => {
  const c = D.cases.find(x => x.id === caseId);
  const taxable = items.reduce((s, i) => s + i[1], 0);
  return { id: n, no: 'KA/2026-27/' + String(n).padStart(4, '0'), caseId, client: c.client, date: day(dOff), due: day(dueOff), items: items.map(([d, a]) => ({ d, a })), taxable, gst: Math.round(taxable * 0.18), total: Math.round(taxable * 1.18), status };
};
D.invoices = [
  inv(31, 1, -60, -30, [['Professional fee, drafting and filing of plaint', 25000], ['Court fee stamps (reimbursement)', 4850]], 'Paid'),
  inv(32, 2, -55, -25, [['Professional fee, appeal memorandum and grounds', 60000]], 'Paid'),
  inv(33, 5, -50, -20, [['Appearance fee, admission hearing', 45000]], 'Overdue'),
  inv(34, 3, -44, -14, [['Professional fee, writ petition', 50000], ['Typing and photocopying', 1800]], 'Paid'),
  inv(35, 8, -38, -8, [['Appearance fee, framing of issues', 15000]], 'Overdue'),
  inv(36, 12, -33, -3, [['Professional fee, evidence stage (part)', 120000]], 'Paid'),
  inv(37, 7, -28, 2, [['Senior counsel briefing and conference', 150000]], 'Unpaid'),
  inv(38, 4, -21, 9, [['Appearance fee, cross-examination of DW1', 20000]], 'Unpaid'),
  inv(39, 9, -14, 16, [['Professional fee, maintenance petition', 10000]], 'Paid'),
  inv(40, 21, -12, 18, [['Professional fee, Sec. 34 petition', 175000]], 'Unpaid'),
  inv(41, 6, -10, 9, [['Professional fee, SLP drafting and settling', 200000], ['AoR filing charges', 15000]], 'Unpaid'),
  inv(42, 14, -6, 24, [['Professional fee, quash petition', 75000]], 'Paid'),
  inv(43, 10, -70, -40, [['Appearance fee, evidence (3 hearings)', 15000]], 'Overdue'),
  inv(44, 13, -4, 26, [['Professional fee, consumer complaint', 40000]], 'Draft'),
];

D.paymentModes = ['UPI', 'Bank Transfer', 'Cash', 'Cheque', 'Card (Credit/Debit)', 'Net Banking', 'Demand Draft'];
D.payments = [
  { id: 1, caseId: 1, client: 1, date: day(-58), amount: 35223, mode: 'UPI', ref: 'UPI-900-001', invoice: 31 },
  { id: 2, caseId: 1, client: 1, date: day(-120), amount: 10000, mode: 'UPI', ref: 'UPI-900-000', invoice: null, note: 'Advance' },
  { id: 3, caseId: 2, client: 2, date: day(-40), amount: 70800, mode: 'Bank Transfer', ref: 'NEFT N254261183340', invoice: 32 },
  { id: 4, caseId: 3, client: 9, date: day(-30), amount: 61124, mode: 'Cheque', ref: 'CHQ 004417 / SBI', invoice: 34 },
  { id: 5, caseId: 12, client: 15, date: day(-20), amount: 141600, mode: 'Net Banking', ref: 'HDFCN26270091', invoice: 36 },
  { id: 6, caseId: 9, client: 6, date: day(-12), amount: 11800, mode: 'Cash', ref: 'Receipt 0193', invoice: 39 },
  { id: 7, caseId: 14, client: 7, date: day(-3), amount: 88500, mode: 'UPI', ref: 'UPI-18822-01', invoice: 42 },
  { id: 8, caseId: 7, client: 11, date: day(-90), amount: 300000, mode: 'Bank Transfer', ref: 'RTGS ICICR52026', invoice: null, note: 'Retainer' },
  { id: 9, caseId: 21, client: 15, date: day(-45), amount: 100000, mode: 'Net Banking', ref: 'HDFCN26211552', invoice: null, note: 'Advance' },
  { id: 10, caseId: 6, client: 5, date: day(-35), amount: 200000, mode: 'Bank Transfer', ref: 'NEFT HCLP0021177', invoice: null, note: 'Advance' },
  { id: 11, caseId: 4, client: 3, date: day(-25), amount: 50000, mode: 'Demand Draft', ref: 'DD 771902', invoice: null },
  { id: 12, caseId: 22, client: 1, date: day(-1), amount: 20000, mode: 'UPI', ref: 'UPI-1402-02', invoice: null },
];

D.expenseCategories = ['Travel', 'Court Fees', 'Documents', 'Stationery', 'Miscellaneous'];
D.expenses = [
  { id: 1, caseId: 1, title: 'Court fee stamps', amount: 4850, cat: 'Court Fees', date: day(-195), mode: 'Cash', status: 'Paid' },
  { id: 2, caseId: 1, title: 'Certified copy of sale deed', amount: 650, cat: 'Documents', date: day(-150), mode: 'Cash', status: 'Paid' },
  { id: 3, caseId: 2, title: 'Certified copy of decree, O.S. 101/2020', amount: 1200, cat: 'Documents', date: day(-370), mode: 'UPI', status: 'Paid' },
  { id: 4, caseId: 2, title: 'Typed set of papers (3 volumes)', amount: 3400, cat: 'Stationery', date: day(-360), mode: 'UPI', status: 'Paid' },
  { id: 5, caseId: 6, title: 'AoR filing charges', amount: 15000, cat: 'Court Fees', date: day(-38), mode: 'Bank Transfer', status: 'Paid' },
  { id: 6, caseId: 6, title: 'Travel to Delhi, mention', amount: 18400, cat: 'Travel', date: day(-36), mode: 'Card (Credit/Debit)', status: 'Paid' },
  { id: 7, caseId: 7, title: 'Paper book printing', amount: 6200, cat: 'Stationery', date: day(-100), mode: 'UPI', status: 'Paid' },
  { id: 8, caseId: 10, title: 'Process fee, summons', amount: 300, cat: 'Court Fees', date: day(-270), mode: 'Cash', status: 'Paid' },
  { id: 9, caseId: 11, title: 'Travel to Madurai Bench', amount: 2800, cat: 'Travel', date: day(-28), mode: 'UPI', status: 'Paid' },
  { id: 10, caseId: 12, title: 'Commissioner fee, inspection', amount: 25000, cat: 'Miscellaneous', date: day(-80), mode: 'Bank Transfer', status: 'Pending' },
  { id: 11, caseId: 3, title: 'Vakalatnama stamp and welfare fund', amount: 130, cat: 'Court Fees', date: day(-59), mode: 'Cash', status: 'Paid' },
  { id: 12, caseId: 21, title: 'Arbitral record copies', amount: 4100, cat: 'Documents', date: day(-85), mode: 'UPI', status: 'Paid' },
  { id: 13, caseId: 9, title: 'Auto fare, Family Court', amount: 240, cat: 'Travel', date: day(-9), mode: 'Cash', status: 'Paid' },
  { id: 14, caseId: 4, title: 'Notarisation of affidavits', amount: 800, cat: 'Documents', date: day(-20), mode: 'Cash', status: 'Paid' },
  { id: 15, caseId: 24, title: 'Execution petition court fee', amount: 2200, cat: 'Court Fees', date: day(-54), mode: 'UPI', status: 'Paid' },
  { id: 16, caseId: 14, title: 'Certified copy of FIR', amount: 150, cat: 'Documents', date: day(-24), mode: 'Cash', status: 'Paid' },
  { id: 17, caseId: 22, title: 'Paper publication of notice', amount: 3600, cat: 'Miscellaneous', date: day(0), mode: 'UPI', status: 'Paid' },
  { id: 18, caseId: 5, title: 'Courier to Union of India', amount: 420, cat: 'Stationery', date: day(-140), mode: 'Cash', status: 'Unpaid' },
];

D.docCategories = ['Court Order', 'Petition', 'Evidence', 'Agreement', 'Affidavit', 'Notice', 'Judgment', 'Invoice', 'Payment Receipt', 'Identity Proof', 'Address Proof', 'Other', 'Draft'];
D.documents = [
  ['Plaint, O.S. 900-2025.pdf', 'Petition', 1, 'pdf', 842, 2, true],
  ['Court_fee_receipt_-_OS_900-2025.pdf', 'Payment Receipt', 1, 'pdf', 118, 1, true],
  ['Rental agreement 2019.pdf', 'Agreement', 1, 'pdf', 1460, 1, false],
  ['Quit notice to tenant.docx', 'Notice', 1, 'docx', 64, 1, true],
  ['Proof affidavit PW1.docx', 'Affidavit', 1, 'docx', 88, 3, false],
  ['Decree, O.S. 101-2020.pdf', 'Judgment', 2, 'pdf', 2210, 1, true],
  ['Memorandum of grounds of appeal.docx', 'Petition', 2, 'docx', 152, 4, false],
  ['Mediation brief - precedent.docx', 'Other', 9, 'docx', 71, 1, false],
  ['TANGEDCO demand notice.pdf', 'Notice', 3, 'pdf', 312, 1, true],
  ['Writ affidavit.pdf', 'Affidavit', 3, 'pdf', 940, 2, false],
  ['Interim order 14.08.2026.pdf', 'Court Order', 3, 'pdf', 188, 1, true],
  ['Arbitral award 02.03.2026.pdf', 'Judgment', 21, 'pdf', 5320, 1, false],
  ['Sec 34 petition.docx', 'Petition', 21, 'docx', 240, 2, false],
  ['Joint development agreement.pdf', 'Agreement', 12, 'pdf', 3880, 1, false],
  ['Site photographs.zip', 'Evidence', 12, 'zip', 18450, 1, false],
  ['Supply invoices bundle.pdf', 'Evidence', 8, 'pdf', 2740, 1, false],
  ['Dishonoured cheque and memo.jpg', 'Evidence', 10, 'jpg', 1210, 1, false],
  ['Statutory notice u-s 138.pdf', 'Notice', 10, 'pdf', 96, 1, true],
  ['SLP paper book.pdf', 'Petition', 6, 'pdf', 9120, 2, false],
  ['Impugned judgment W.A. 2211-2025.pdf', 'Judgment', 6, 'pdf', 1630, 1, true],
  ['FIR 311-2026.pdf', 'Evidence', 14, 'pdf', 420, 1, false],
  ['Aadhaar - Selvi Ramasamy.jpg', 'Identity Proof', 9, 'jpg', 380, 1, false],
  ['Marriage certificate.pdf', 'Evidence', 18, 'pdf', 290, 1, false],
  ['Consumer complaint.docx', 'Petition', 13, 'docx', 118, 2, true],
  ['Ventilator warranty.pdf', 'Agreement', 13, 'pdf', 770, 1, false],
  ['Patta extract.pdf', 'Address Proof', 11, 'pdf', 205, 1, false],
  ['GST show-cause notice.pdf', 'Notice', 7, 'pdf', 650, 1, false],
  ['Order dated 12.06.2026.pdf', 'Court Order', 17, 'pdf', 410, 1, true],
  ['Vakalatnama - Kannan.pdf', 'Other', 22, 'pdf', 132, 1, false],
  ['Case status note for client.docx', 'Draft', 1, 'docx', 42, 1, true],
  ['Board resolution authorising suit.pdf', 'Other', 26, 'pdf', 175, 1, false],
  ['Invoice KA-2026-27-0041.pdf', 'Invoice', 6, 'pdf', 61, 1, true],
].map(([name, cat, caseId, ext, kb, version, shared], i) => {
  const c = D.cases.find(x => x.id === caseId);
  return { id: i + 1, name, cat, caseId, client: c.client, ext, kb, version, shared, date: day(-((i * 7) % 90) - 1), by: D.advocates[(i % 4)].name, status: i === 15 ? 'Archived' : 'Active' };
});

D.tasks = [
  { id: 1, title: 'Prepare mediation brief for client meeting', caseId: 9, priority: 'High', due: day(1), assignee: 3, by: 1, status: 'In Progress' },
  { id: 2, title: 'Research: recovery of possession, arrears of rent and mesne profits', caseId: 1, priority: 'High', due: day(0), assignee: 4, by: 3, status: 'To review', review: 'Awaiting review', hours: 3.5, note: 'Collated 6 Madras HC judgments, summary in shared drive.' },
  { id: 3, title: 'Draft grounds of appeal and memorandum', caseId: 2, priority: 'Medium', due: day(-2), assignee: 3, by: 2, status: 'Completed', review: 'Approved' },
  { id: 4, title: 'Research: precedents on misappreciation of evidence in first appeals (Sec. 96 CPC)', caseId: 2, priority: 'Medium', due: day(2), assignee: 4, by: 2, status: 'In Progress', review: 'Changes requested', reviewNote: 'Add the 2023 Division Bench ruling and drop the Kerala cases.' },
  { id: 5, title: 'SLP list of dates', caseId: 6, priority: 'High', due: day(3), assignee: 3, by: 2, status: 'In Progress' },
  { id: 6, title: 'O.S. 150/2025 cross-examination questions for DW1', caseId: 4, priority: 'High', due: day(0), assignee: 1, by: 1, status: 'In Progress' },
  { id: 7, title: 'File counter affidavit in W.P. 14600/2026', caseId: 3, priority: 'High', due: day(2), assignee: 3, by: 1, status: 'In Progress' },
  { id: 8, title: 'Collect certified copy of interim order', caseId: 3, priority: 'Low', due: day(4), assignee: 5, by: 3, status: 'In Progress' },
  { id: 9, title: 'Reconcile Akshayam Traders ledger with supply invoices', caseId: 8, priority: 'Medium', due: day(1), assignee: 6, by: 2, status: 'To review', review: 'Awaiting review', hours: 2 },
  { id: 10, title: 'Prepare written submissions, Sec. 34 petition', caseId: 21, priority: 'Medium', due: day(6), assignee: 1, by: 1, status: 'In Progress' },
  { id: 11, title: 'Send hearing update to Dr. Padmavathi', caseId: 13, priority: 'Low', due: day(-1), assignee: 5, by: 3, status: 'Completed' },
  { id: 12, title: 'Obtain patta extract from Taluk office', caseId: 11, priority: 'Medium', due: day(5), assignee: 4, by: 2, status: 'In Progress' },
  { id: 13, title: 'Draft legal notice to Metro Water Board', caseId: 26, priority: 'Medium', due: day(3), assignee: 3, by: 1, status: 'In Progress' },
  { id: 14, title: 'Index paper book volumes I-III', caseId: 7, priority: 'Low', due: day(8), assignee: 4, by: 1, status: 'In Progress' },
  { id: 15, title: 'Draft divorce petition by mutual consent', caseId: 18, priority: 'Low', due: day(-10), assignee: 3, by: 3, status: 'Canceled' },
  { id: 16, title: 'Raise invoice for evidence stage, C.S. 344/2024', caseId: 12, priority: 'Medium', due: day(2), assignee: 6, by: 1, status: 'In Progress' },
];

D.notifications = [
  { id: 1, kind: 'HEARING_REMINDER', text: 'O.S. No. 900/2025 is listed today as item 14 in Court No. VI', at: day(0, 7, 0), unread: true, route: '#/cases/1' },
  { id: 2, kind: 'TASK_SUBMITTED', text: 'Karthik R. submitted research on recovery of possession for review', at: day(0, 9, 12), unread: true, route: '#/tasks' },
  { id: 3, kind: 'PAYMENT_RECEIVED', text: 'Rs. 20,000 received from Kannan by UPI', at: day(-1, 18, 40), unread: true, route: '#/payments' },
  { id: 4, kind: 'OVERDUE_PAYMENT_REMINDER', text: 'Invoice KA/2026-27/0033 for Coromandel Builders LLP is 20 days overdue', at: day(-1, 9, 0), unread: true, route: '#/invoices' },
  { id: 5, kind: 'CLIENT_REGISTERED', text: 'New client assigned to you: Selvi Ramasamy', at: day(-2, 11, 5), unread: false, route: '#/clients/6' },
  { id: 6, kind: 'HEARING_RESCHEDULED', text: 'C.M.A. No. 1200/2025 moved to ' + day(2).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), at: day(-2, 16, 30), unread: false, route: '#/cases/5' },
  { id: 7, kind: 'TASK_CHANGES_REQUESTED', text: 'Arjun Menon requested changes on Sec. 96 CPC research', at: day(-3, 12, 0), unread: false, route: '#/tasks' },
  { id: 8, kind: 'CASE_STATUS_UPDATED', text: 'A.S. No. 212/2024 marked reserved for judgment', at: day(-4, 17, 10), unread: false, route: '#/cases/16' },
];

D.deliveryLog = [
  ['HEARING_REMINDER', 'Email', 'Sent', 'Kannan', 'kannan.m@gmail.com', 'Hearing today: O.S. No. 900/2025', 0, 7, 0],
  ['HEARING_REMINDER', 'In-App', 'Sent', 'Rajesh Kumar', 'rajesh@kumar-associates.demo', 'O.S. No. 900/2025 listed as item 14', 0, 7, 0],
  ['TASK_SUBMITTED', 'In-App', 'Sent', 'Priya Nair', 'priya@kumar-associates.demo', 'Research submitted for review', 0, 9, 12],
  ['PAYMENT_RECEIVED', 'Email', 'Sent', 'Kannan', 'kannan.m@gmail.com', 'Payment receipt Rs. 20,000', -1, 18, 41],
  ['OVERDUE_PAYMENT_REMINDER', 'Email', 'Failed', 'Coromandel Builders LLP', 'legal@coromandelbuilders.in', 'Reminder: invoice KA/2026-27/0033 overdue', -1, 9, 0],
  ['INVOICE_GENERATED', 'Email', 'Sent', 'HCL Technologies Ltd.', 'legal.chennai@hcl.demo', 'Invoice KA/2026-27/0041', -10, 15, 22],
  ['HEARING_SCHEDULED', 'Email', 'Sent', 'R. Murugan', 'murugan.r@yahoo.co.in', 'Next hearing: A.S. No. 700/2025', -6, 12, 4],
  ['CLIENT_REGISTERED', 'Email', 'Sent', 'Priya Nair', 'priya@kumar-associates.demo', 'New client assigned to you: Selvi Ramasamy', -2, 11, 5],
  ['HEARING_RESCHEDULED', 'WhatsApp', 'Failed', 'Coromandel Builders LLP', '+91 44 4211 9900', 'Hearing moved: C.M.A. No. 1200/2025', -2, 16, 30],
  ['TASK_ASSIGNED', 'In-App', 'Sent', 'Karthik R.', 'karthik@kumar-associates.demo', 'Task: Index paper book volumes I-III', -3, 10, 0],
  ['CASE_CREATED', 'In-App', 'Sent', 'Rajesh Kumar', 'rajesh@kumar-associates.demo', 'W.P. No. 20114/2026 added', -5, 14, 0],
  ['PASSWORD_RESET', 'Email', 'Pending', 'Lakshmi S.', 'lakshmi@kumar-associates.demo', 'Your verification code', 0, 9, 40],
].map(([kind, channel, status, name, to, subject, o, h, m], i) => ({ id: i + 1, kind, channel, status, name, to, subject, at: day(o, h, m) }));

D.activity = [
  ['CASE_STATUS_CHANGED', 'Cases', 'Rajesh Kumar', 'A.S. No. 212/2024 set to Pending (reserved)', -4, 17, 10, { field: 'Status', from: 'Active', to: 'Pending' }],
  ['PAYMENT_RECEIVED', 'Payments', 'Suresh Kumar', 'Rs. 20,000 from Kannan', -1, 18, 40],
  ['DOCUMENT_UPLOADED', 'Documents', 'Priya Nair', 'Proof affidavit PW1.docx (v3) on O.S. No. 900/2025', 0, 9, 55],
  ['HEARING_CREATED', 'Hearings', 'Lakshmi S.', 'Hearing on W.P. No. 14600/2026 for ' + day(0).toLocaleDateString('en-IN'), -3, 11, 30],
  ['INVOICE_GENERATED', 'Invoices', 'Suresh Kumar', 'KA/2026-27/0044 for Dr. V. Padmavathi', -4, 12, 10],
  ['CLIENT_CREATED', 'Clients', 'Lakshmi S.', 'Selvi Ramasamy', -12, 10, 20],
  ['CASE_CREATED', 'Cases', 'Rajesh Kumar', 'W.P. No. 20114/2026', -5, 14, 0],
  ['EXPENSE_CREATED', 'Expenses', 'Suresh Kumar', 'Paper publication of notice, Rs. 3,600', 0, 10, 5],
  ['HEARING_RESCHEDULED', 'Hearings', 'Arjun Menon', 'C.M.A. No. 1200/2025 moved by 2 days', -2, 16, 30, { field: 'Date', from: day(-2).toLocaleDateString('en-IN'), to: day(2).toLocaleDateString('en-IN') }],
  ['INVOICE_PAID', 'Invoices', 'Suresh Kumar', 'KA/2026-27/0042 marked paid', -3, 13, 0],
  ['CLIENT_UPDATED', 'Clients', 'Priya Nair', 'Dr. V. Padmavathi: phone changed', -6, 15, 45, { field: 'Phone', from: '+91 98400 55218', to: '+91 98400 55219' }],
  ['DOCUMENT_DELETED', 'Documents', 'Arjun Menon', 'Draft notice (superseded).docx', -7, 12, 0],
  ['CASE_UPDATED', 'Cases', 'Priya Nair', 'O.S. No. 150/2025: tag "Follow Up" added', -1, 15, 15],
  ['LOGIN_FAILED', 'Auth', 'unknown', 'Failed sign-in for meena@kumar-associates.demo', -1, 23, 48, null, 'Failed'],
].map(([action, module, user, title, o, h, m, change, status], i) => ({ id: 9000 + i, action, module, user, title, at: day(o, h, m), change, status: status || 'Success', ip: '10.0.4.' + (20 + i), browser: i % 3 ? 'Chrome 129' : 'Edge 129', os: 'Windows 11' })).sort((a, b) => b.at - a.at);

D.acts = [
  { id: 1, title: 'The Code of Civil Procedure, 1908', no: 5, year: 1908, juris: 'Central', ministry: 'Ministry of Law and Justice', dept: 'Legislative Department', sections: 158, desc: 'An Act to consolidate and amend the laws relating to the procedure of the Courts of Civil Judicature.' },
  { id: 2, title: 'The Bharatiya Nyaya Sanhita, 2023', no: 45, year: 2023, juris: 'Central', ministry: 'Ministry of Home Affairs', dept: 'Legislative Department', sections: 358, desc: 'An Act to consolidate and amend the provisions relating to offences and for matters connected therewith.' },
  { id: 3, title: 'The Bharatiya Nagarik Suraksha Sanhita, 2023', no: 46, year: 2023, juris: 'Central', ministry: 'Ministry of Home Affairs', dept: 'Legislative Department', sections: 531, desc: 'An Act to consolidate and amend the law relating to Criminal Procedure.' },
  { id: 4, title: 'The Arbitration and Conciliation Act, 1996', no: 26, year: 1996, juris: 'Central', ministry: 'Ministry of Law and Justice', dept: 'Legislative Department', sections: 86, desc: 'An Act to consolidate and amend the law relating to domestic arbitration, international commercial arbitration and enforcement of foreign arbitral awards.' },
  { id: 5, title: 'The Negotiable Instruments Act, 1881', no: 26, year: 1881, juris: 'Central', ministry: 'Ministry of Finance', dept: 'Department of Financial Services', sections: 148, desc: 'An Act to define and amend the law relating to Promissory Notes, Bills of Exchange and Cheques.' },
  { id: 6, title: 'The Tamil Nadu Regulation of Rights and Responsibilities of Landlords and Tenants Act, 2017', no: 42, year: 2017, juris: 'Tamil Nadu', ministry: 'Housing and Urban Development', dept: 'Housing and Urban Development Department', sections: 49, desc: 'An Act to regulate rental of premises and to protect the interest of landlords and tenants.' },
  { id: 7, title: 'The Consumer Protection Act, 2019', no: 35, year: 2019, juris: 'Central', ministry: 'Ministry of Consumer Affairs', dept: 'Department of Consumer Affairs', sections: 107, desc: 'An Act to provide for protection of the interests of consumers.' },
  { id: 8, title: 'The Tamil Nadu Court-fees and Suits Valuation Act, 1955', no: 14, year: 1955, juris: 'Tamil Nadu', ministry: 'Law Department', dept: 'Law Department', sections: 79, desc: 'An Act to amend and consolidate the law relating to court-fees and valuation of suits in the State of Tamil Nadu.' },
  { id: 9, title: 'The Bharatiya Sakshya Adhiniyam, 2023', no: 47, year: 2023, juris: 'Central', ministry: 'Ministry of Home Affairs', dept: 'Legislative Department', sections: 170, desc: 'An Act to consolidate and to provide for general rules and principles of evidence for fair trial.' },
  { id: 10, title: 'The Hindu Marriage Act, 1955', no: 25, year: 1955, juris: 'Central', ministry: 'Ministry of Law and Justice', dept: 'Legislative Department', sections: 30, desc: 'An Act to amend and codify the law relating to marriage among Hindus.' },
];
D.actSections = [
  { ch: 'Part I: Suits in General', items: [['9', 'Courts to try all civil suits unless barred'], ['10', 'Stay of suit'], ['11', 'Res judicata'], ['20', 'Other suits to be instituted where defendants reside or cause of action arises']] },
  { ch: 'Part VII: Appeals', items: [['96', 'Appeal from original decree'], ['100', 'Second appeal'], ['104', 'Orders from which appeal lies']] },
  { ch: 'Part VIII: Reference, Review and Revision', items: [['113', 'Reference to High Court'], ['114', 'Review'], ['115', 'Revision']] },
];

D.lawCodes = [
  ['IPC', 'BNS', '302', '103', 'Changed', 'Punishment for murder. Sub-section (2) adds mob lynching on grounds of race, caste, community.'],
  ['IPC', 'BNS', '420', '318(4)', 'Changed', 'Cheating and dishonestly inducing delivery of property, merged into Sec. 318.'],
  ['IPC', 'BNS', '124A', '152', 'Changed', 'Sedition replaced by acts endangering sovereignty, unity and integrity of India.'],
  ['IPC', 'BNS', '377', '—', 'Repealed', 'Unnatural offences. No corresponding provision.'],
  ['IPC', 'BNS', '497', '—', 'Repealed', 'Adultery. Struck down in Joseph Shine (2018) and omitted.'],
  ['IPC', 'BNS', '498A', '85', 'Changed', 'Cruelty by husband or relatives of husband.'],
  ['IPC', 'BNS', '506', '351', 'Changed', 'Criminal intimidation.'],
  ['CrPC', 'BNSS', '125', '144', 'Changed', 'Order for maintenance of wives, children and parents.'],
  ['CrPC', 'BNSS', '438', '482', 'Changed', 'Direction for grant of bail to person apprehending arrest.'],
  ['CrPC', 'BNSS', '482', '528', 'Changed', 'Saving of inherent powers of High Court.'],
  ['CrPC', 'BNSS', '164', '183', 'Changed', 'Recording of confessions and statements; audio-video recording permitted.'],
  ['IEA', 'BSA', '65B', '63', 'Changed', 'Admissibility of electronic records; certificate in Schedule.'],
  ['IEA', 'BSA', '25', '23', 'Changed', 'Confession to police officer not to be proved.'],
].map(([from, to, old, nw, kind, desc], i) => ({ id: i + 1, from, to, old, nw, kind, desc }));

D.dictionary = [
  ['Mesne profits', 'Profits which the person in wrongful possession of property actually received or might with ordinary diligence have received, together with interest, but excluding profits due to improvements made by that person. (Sec. 2(12), CPC)', 'अन्तःकालीन लाभ'],
  ['Res judicata', 'A matter already adjudged. No court shall try any suit or issue directly and substantially in issue in a former suit between the same parties, decided by a competent court. (Sec. 11, CPC)', 'पूर्व न्याय'],
  ['Vakalatnama', 'A document by which a party authorises an advocate to appear, plead and act on their behalf in a court proceeding.', 'वकालतनामा'],
  ['Ex parte', 'On behalf of, or involving, one party only, in the absence of the other party.', 'एकपक्षीय'],
  ['Caveat', 'A notice lodged by a person claiming a right to be heard before any order is passed on an application expected to be made in a suit or proceeding. (Sec. 148A, CPC)', 'चेतावनी'],
  ['Sub judice', 'Under judicial consideration and therefore prohibited from public discussion elsewhere.', 'न्यायाधीन'],
  ['Locus standi', 'The right or capacity to bring an action or to appear in a court.', 'सुने जाने का अधिकार'],
  ['Interlocutory application', 'An application made in a pending proceeding for an interim order, not finally disposing of the rights of the parties.', 'अन्तर्वर्ती आवेदन'],
  ['Decree', 'The formal expression of an adjudication which conclusively determines the rights of the parties with regard to all or any of the matters in controversy. (Sec. 2(2), CPC)', 'डिक्री'],
  ['Cause of action', 'The bundle of facts which it would be necessary for the plaintiff to prove, if traversed, to support the right to judgment.', 'वाद हेतुक'],
  ['Mandamus', 'A writ commanding a public authority to perform a public duty which it has refused or failed to perform.', 'परमादेश'],
  ['Certiorari', 'A writ issued by a superior court to quash an order of an inferior court or tribunal made without or in excess of jurisdiction.', 'उत्प्रेषण'],
].map(([term, def, hi], i) => ({ id: i + 1, term, def, hi }));

D.appeals = [
  { id: 1, source: 17, appealNo: 'A.S. No. 1904/2026', forum: 'Madras High Court', parties: 'Ganesh Mills vs Sri Lakshmi Textiles Pvt. Ltd.', filed: day(-18), matched: day(-17), score: 94, status: 'New' },
  { id: 2, source: 25, appealNo: 'SLP(C) Diary No. 8000/2026', forum: 'Supreme Court of India', parties: 'The Malayalee Club vs K. M. Anand Joshi', filed: day(-40), matched: day(-39), score: 81, status: 'Confirmed' },
  { id: 3, source: 19, appealNo: '(number not listed)', forum: 'Madras High Court', parties: 'K. Rathinavel vs R. Murugan & Anr.', filed: day(-60), matched: day(-58), score: 62, status: 'Dismissed' },
];

D.templates = [
  { id: 1, name: 'Vakalatnama, Madras High Court', type: 'Vakalatnama', lang: 'English', status: 'Ready', fields: 9 },
  { id: 2, name: 'Plaint for recovery of possession', type: 'Plaint', lang: 'English', status: 'Ready', fields: 22 },
  { id: 3, name: 'Memorandum of grounds of appeal (Sec. 96 CPC)', type: 'Appeal memorandum', lang: 'English', status: 'Ready', fields: 14 },
  { id: 4, name: 'Legal notice under Sec. 138 NI Act', type: 'Notice', lang: 'English', status: 'Ready', fields: 11 },
  { id: 5, name: 'Lease deed (residential)', type: 'Agreement', lang: 'Tamil', status: 'Processing', fields: 0 },
  { id: 6, name: 'Mediation brief', type: 'Mediation brief', lang: 'English', status: 'Failed', fields: 0 },
];
D.drafts = [
  { id: 118, template: 'Plaint for recovery of possession', caseId: 1, docs: 3, created: day(-2, 15, 10), cited: [12, 12], status: 'Ready' },
  { id: 117, template: 'Memorandum of grounds of appeal (Sec. 96 CPC)', caseId: 2, docs: 2, created: day(-4, 11, 0), cited: [9, 10], status: 'Ready' },
  { id: 116, template: '—', caseId: 9, docs: 1, created: day(0, 9, 20), cited: [0, 0], status: 'Generating' },
  { id: 115, template: 'Legal notice under Sec. 138 NI Act', caseId: 10, docs: 2, created: day(-9, 17, 0), cited: [4, 4], status: 'Ready' },
  { id: 114, template: 'Vakalatnama, Madras High Court', caseId: 28, docs: 0, created: day(-5, 12, 30), cited: [0, 0], status: 'Ready' },
  { id: 113, template: 'Lease deed (residential)', caseId: 22, docs: 1, created: day(-12, 10, 0), cited: [0, 3], status: 'Failed' },
];
D.playbooks = [
  { id: 1, name: 'Commercial lease, landlord side', category: 'Real estate', status: 'Ready', sources: 4, clauses: [
    { type: 'Rent escalation', standard: '5% annually, compounded', red: ['No escalation cap above 10%'], fallback: ['7.5% every two years if tenant commits to 5-year lock-in'] },
    { type: 'Security deposit', standard: '10 months\' rent, refundable without interest', red: ['Deposit below 6 months\' rent'], fallback: ['6 months plus bank guarantee'] },
    { type: 'Lock-in', standard: '36 months', red: ['Tenant exit before 12 months without penalty'], fallback: ['24 months with 3 months\' rent as exit fee'] },
  ] },
  { id: 2, name: 'Joint development agreement, developer side', category: 'Construction', status: 'Ready', sources: 6, clauses: [
    { type: 'Sharing ratio', standard: '60:40 built-up area in favour of developer', red: ['Below 55% to developer'], fallback: ['55% plus premium on floor-space index'] },
    { type: 'Completion timeline', standard: '36 months from plan sanction, 6 months grace', red: ['Liquidated damages above 1% per month'], fallback: ['Capped at 10% of land owner share'] },
  ] },
  { id: 3, name: 'Employment settlement, employer side', category: 'Labour', status: 'Processing', sources: 3, clauses: [] },
];

D.roles = [
  { id: 1, name: 'Super Admin', desc: 'Full control of the practice, including users, roles and backups.', users: 1 },
  { id: 2, name: 'Senior Advocate', desc: 'Runs matters end to end, reviews juniors\' work, raises invoices.', users: 2 },
  { id: 3, name: 'Junior Advocate', desc: 'Works on assigned matters; submits drafts and research for review.', users: 1 },
  { id: 4, name: 'Intern', desc: 'Research and paperwork on assigned tasks only.', users: 1 },
  { id: 5, name: 'Receptionist', desc: 'Front desk: clients, hearings calendar and document intake.', users: 1 },
  { id: 6, name: 'Accountant', desc: 'Invoices, payments, expenses and financial reports.', users: 1 },
  { id: 7, name: 'Client', desc: 'Portal access to their own cases, invoices and shared documents.', users: 6 },
];
D.permissionModules = {
  Cases: ['CASE_VIEW', 'CASE_CREATE', 'CASE_EDIT', 'CASE_DELETE', 'CASE_ALERTS'],
  Clients: ['CLIENT_VIEW', 'CLIENT_CREATE', 'CLIENT_EDIT', 'CLIENT_DELETE'],
  Hearings: ['EVENT_VIEW', 'EVENT_CREATE', 'EVENT_DELETE'],
  Documents: ['DOCUMENT_VIEW', 'DOCUMENT_UPLOAD', 'DOCUMENT_EDIT', 'DOCUMENT_DELETE'],
  Billing: ['INVOICE_VIEW', 'INVOICE_CREATE', 'INVOICE_EDIT', 'PAYMENT_VIEW', 'PAYMENT_CREATE', 'EXPENSE_VIEW', 'EXPENSE_CREATE', 'EXPENSE_EDIT', 'EXPENSE_DELETE'],
  Tasks: ['TASK_VIEW', 'TASK_CREATE', 'TASK_EDIT', 'TASK_ASSIGN'],
  Drafting: ['DRAFT_VIEW', 'DRAFT_CREATE', 'DRAFT_MANAGE', 'DRAFT_EXPORT'],
  Reports: ['REPORT_VIEW', 'REPORT_EXPORT'],
  Administration: ['USER_MANAGE', 'ROLE_MANAGE', 'AUDIT_VIEW', 'BACKUP_MANAGE', 'SETTINGS_EDIT'],
};
D.rolePerms = {
  'Super Admin': Object.values(D.permissionModules).flat(),
  'Senior Advocate': Object.values(D.permissionModules).flat().filter(p => !['ROLE_MANAGE', 'BACKUP_MANAGE'].includes(p)),
  'Junior Advocate': ['CASE_VIEW', 'CASE_EDIT', 'CLIENT_VIEW', 'EVENT_VIEW', 'EVENT_CREATE', 'DOCUMENT_VIEW', 'DOCUMENT_UPLOAD', 'TASK_VIEW', 'TASK_EDIT', 'DRAFT_VIEW', 'DRAFT_CREATE'],
  'Intern': ['CASE_VIEW', 'DOCUMENT_VIEW', 'TASK_VIEW', 'DRAFT_VIEW'],
  'Receptionist': ['CASE_VIEW', 'CLIENT_VIEW', 'CLIENT_CREATE', 'CLIENT_EDIT', 'EVENT_VIEW', 'EVENT_CREATE', 'DOCUMENT_VIEW', 'DOCUMENT_UPLOAD'],
  'Accountant': ['CASE_VIEW', 'CLIENT_VIEW', 'INVOICE_VIEW', 'INVOICE_CREATE', 'INVOICE_EDIT', 'PAYMENT_VIEW', 'PAYMENT_CREATE', 'EXPENSE_VIEW', 'EXPENSE_CREATE', 'EXPENSE_EDIT', 'REPORT_VIEW', 'REPORT_EXPORT'],
  'Client': [],
};

D.backups = [
  { id: 1, at: day(0, 2, 0), type: 'Full', size: '412 MB', dur: '3m 41s', health: 100, status: 'Completed', sections: [['Database', 'Completed', '48s'], ['Documents', 'Completed', '2m 40s'], ['Reports', 'Completed', '9s'], ['Settings', 'Completed', '4s']] },
  { id: 2, at: day(-1, 2, 0), type: 'Database', size: '38 MB', dur: '51s', health: 100, status: 'Completed', sections: [['Database', 'Completed', '51s']] },
  { id: 3, at: day(-2, 2, 0), type: 'Full', size: '409 MB', dur: '4m 02s', health: 88, status: 'Partial', sections: [['Database', 'Completed', '47s'], ['Documents', 'Failed', '3m 05s'], ['Reports', 'Completed', '6s'], ['Settings', 'Completed', '4s']] },
  { id: 4, at: day(-7, 2, 0), type: 'Full', size: '398 MB', dur: '3m 30s', health: 100, status: 'Completed', sections: [['Database', 'Completed', '44s'], ['Documents', 'Completed', '2m 35s'], ['Reports', 'Completed', '7s'], ['Settings', 'Completed', '4s']] },
  { id: 5, at: day(-14, 2, 0), type: 'Settings', size: '120 KB', dur: '3s', health: 100, status: 'Completed', sections: [['Settings', 'Completed', '3s']] },
];

/* Display board rows for "My forums" */
D.displayBoard = [
  { court: 'Madras High Court, Principal Bench', rows: [
    { court: 'Court Hall 4', item: 49, yours: 52, judge: 'R. Hemalatha, J.', stage: 'Hearing', progress: 'In progress', vc: 'Link' },
    { court: 'Court Hall 9', item: 18, yours: null, judge: 'C. Saravanan, J.', stage: 'Admission', progress: 'In progress', vc: 'Link' },
    { court: 'Court Hall 12', item: 31, yours: 37, judge: 'N. Seshasayee, J.', stage: 'Final hearing', progress: 'In progress', vc: '—' },
    { court: 'Court Hall 21', item: 0, yours: null, judge: 'Abdul Quddhose, J.', stage: 'Not sitting', progress: 'List over', vc: '—', over: true },
    { court: 'Court Hall 33', item: 58, yours: null, judge: 'A. D. Jagadish Chandira, J.', stage: 'Bail', progress: 'In progress', vc: 'Link' },
  ] },
  { court: 'City Civil Court, Chennai', rows: [
    { court: 'Court No. II', item: 6, yours: null, judge: 'II Addl. Judge', stage: 'Evidence', progress: 'In progress', vc: '—' },
    { court: 'Court No. VI', item: 11, yours: 14, judge: 'VI Asst. Judge', stage: 'Evidence', progress: 'In progress', vc: '—' },
    { court: 'Court No. XV', item: 22, yours: null, judge: 'XV Asst. Judge', stage: 'Issues', progress: 'Passed over', vc: '—' },
  ] },
];

/* Client portal messages */
D.messages = [
  { subject: 'Hearing update: O.S. No. 900/2025', at: day(-6, 18, 0), body: 'Dear Mr. Kannan,\n\nThe matter was taken up today and PW1 was examined in part. The suit is listed next for further evidence. Please be present in Court No. VI by 10:15 am with the original rental agreement.\n\nRegards,\nRajesh Kumar' },
  { subject: 'Invoice KA/2026-27/0031', at: day(-60, 12, 0), body: 'Please find attached our invoice for drafting and filing of the plaint. Payment may be made to the account mentioned on the invoice.' },
];
