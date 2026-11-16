import type { ModuleTranslation } from "./index";

/** Draft translation of the built-in Sales Academy, to be checked by a native speaker. */
export const nyn: ModuleTranslation[] = [
  {
    key: "m1",
    title: "Eby'okubanza ahari solar n'amasharaazi",
    summary:
      "Ebipimo, ebicweka bya sisitemu ya solar n'emiringo ya sisitemu, obaase kushoboorora solar gye kandi omanye eki omukiriya arikwetenga.",
    lessons: [
      {
        key: "m1-l1",
        title: "Power, energy na yunit ya Yaka",
        body: `Abakiriya nibagamba ahari "yunit" n'ebi barikushashura ahari Yaka. Kubahwera nooyetenga kumanya ebintu bibiri, kandi otaribitabura na kakye.

## Power n'amaani agu ekyoma kirikusika
Power neepimwa omu watts (W). Etaara ya 10 W neesika makye; kettle ya 2,000 W neesika maingi. 1,000 W ni kilowatt 1 (kW). Power niyo erikworeka obuhango bwa inverter, ahabw'okuba inverter eine kuha amasharaazi byona ebyakiibwe omu bwire bumwe.

## Energy ni power ekoreisibwe omu bwire
Energy neepimwa omu watt-hours (Wh) nari kilowatt-hours (kWh). Yunit emwe ya Yaka ni kWh emwe.

Energy = power x eshaaha. Tiivi ya 100 W eyaakire eshaaha 10 neekoresa 1,000 Wh, niyo 1 kWh, niyo yunit 1. Energy niyo erikworeka panel zingahi na battery erikwingana ki ebi omukiriya arikwetenga.

## Ebindi bibiri eby'okuhurikiza
- Peak load: amaani agarikukirayo agarikukoresibwa omurundi gumwe. Eka neebaasa kukoresa energy nkye omu izooba kwonka ekagira peak mpango, paasi, kettle na pampu ku birikukora hamwe.
- Surge y'okutandika: firiiji, freezer, pampu n'ebindi ebiine motor nibisika amaani agarikukira emirundi mingi agu birikukoresa obutoosha, kumara akaire kakye ku birikutandika. Inverter eine kugumira ekyo.

Omukiriya ku arikugira ngu "ningura yunit 150 omu kwezi", ezo ni nka 5 kWh buri izooba. Omubaro ogwo gwonka nigukworeka sisitemu y'obuhango obu orikubaasa kugambaho.`
      },
      {
        key: "m1-l2",
        title: "Ebicweka bya sisitemu ya solar",
        body: `Buri sisitemu ei orikuguza eyombekirwe omu bicweka bikye nibyo bimwe. Manya eki buri kimwe kirikukora n'omubaro oguri aha kyapa kyakyo ogw'omugasho.

## Solar panel
Nizikora amasharaazi kuruga omu mushana. Ekyapa nikyoreka watts-peak (Wp), amaani agu erikukora omu mushana ogurungi munonga. Agu erikukora buzima gaba gari ahansi, nikyo ekirikureetera okubara sisitemu kukoresa eshaaha z'omushana z'okwegyendesereza. Panel nizikwatanisibwa omu runyiriri (series) zikakora "string", kandi voltage ya string eine kuhikaana na inverter nari charge controller.

## Inverter
Neehindura amasharaazi ga battery n'aga solar (DC) gakaba amasharaazi agu ebyoma birikukoresa (AC). Ekyapa nikyoreka amaani g'obutoosha (continuous) omu watts, kandi kaingi n'omubaro gwa surge oguri ahaiguru. Inverter nyingi zihandiikirweho kVA; omubaro gwa watt nigwo ogw'okugyeragyeranisa n'ebyoma by'omukiriya.

## Battery
Nizibiika energy y'okukoresa nyekiro n'obu amasharaazi garikuba gagyenzire. Ekyapa nikyoreka voltage (V) n'obuhango omu amp-hours (Ah). Energy = V x Ah, n'ahabw'ekyo battery ya 48 V 100 Ah neebiika nka 4,800 Wh. Ti yoona eshemereire kukoresibwa: oku battery erikubaasa kukoresibwa okuhika ahansi nikirugiirira aha muringo gwayo (chemistry) n'omubaro gw'abaagikozire.

## Charge controller
Neeragiirira oku panel zirikucaajinga battery. Controller za MPPT niziiha maingi omu panel okukira eza PWM. Inverter nyingi za hybrid ziine controller omunda yaazo.

## Ebindi byona
Ebyoma by'okuhamizaho panel (mounting), waya, breakers, fuses, surge protection na earthing. Tibirikushemeza, kwonka sisitemu etabiine terikwesigwa aha by'oburinzi kandi tehwaire. Otaribiihamu ngu ebeeyi ereebekye nk'eri ahansi.`
      },
      {
        key: "m1-l3",
        title: "Emiringo ya sisitemu n'abu erikushemerera",
        body: `Solar Switch neekora n'emiringo ena ya sisitemu. Okutoorana ehikire nikutandika n'ekibuuzo kimwe: amasharaazi ga UEDCL (grid) g'omukiriya nigeesigwa gata?

## Grid-tied
Panel na inverter hataine battery. Neekyendeeza biiru nyomushana. Terikuha masharaazi obu aga UEDCL garikuba gagyenzire, kandi oine kukigamba butunu. Neeshemerera abakiriya abaine amasharaazi ga UEDCL agarikwesigwa kandi abarikukoresa maingi nyomushana.

## Hybrid
Panel, battery n'okukwatanisibwa na grid. Solar neekoresa ebyoma kandi ecaajinga battery; grid niyo erikuhwera ku ebyo bitarikumara. Neeshemerera amaka na bizinensi ahu amasharaazi garikugyenda kaingi kandi omukiriya arikwenda byombi, okukyendeeza sente na backup.

## Off-grid
Panel na battery hataine grid na kakye. Sisitemu eine kwemera byona, n'omu biro by'ebicu, n'ahabw'ekyo battery nizibarwa omu biro ebi sisitemu erikubaasa kwemera yonka (days of autonomy). Neeshemerera emyanya etakwatsirwe ahari grid.

## Backup yonka
Inverter na battery ebirikucaajingwa grid, hataine panel. Neegumya ebyoma by'omugasho nibikora amasharaazi ku garikugyenda, kwonka terikukyendeeza biiru. Panel kaingi nizibaasa kwongyerwaho bwanyima.

## Ebyoma by'omugasho munonga (critical loads)
Aha sisitemu za hybrid n'eza backup, buuza ebyoma ebiine kuguma nibikora amasharaazi ku garikugyenda: amataara, firiiji, router, till, ebyoma by'eirwariro. Okuha backup ebyo byonka nikigumya battery, n'ebeeyi, biri ahantu ahashemereire.`
      },
      {
        key: "m1-l4",
        title: "Ebi solar erikubaasa n'ebi etarikubaasa kuraganisa",
        body: `Abakiriya nibeesiga omutunzi (agent) orikugamba amazima. Ebi nibyo bintu ebi solar etarikubaasa, ebi orikushoboorora buri murundi.

- Omushana niguhindahinduka. Sisitemu nizibarwa aha shaaha z'omushana z'okwegyendesereza ngu zigume nizikora n'omu kwezi kubi, kwonka ebiro bingi by'omwirima n'enjura ebirikukuratana nibikyendeeza ebi sisitemu yoona erikukora.
- Battery ziine ahu zirikugarukira. Eshaaha za backup nizirugiirira aha byakiibwe. Omukiriya ku arikwongyera heater nari paasi aha sisitemu ebaziirwe amataara na firiiji, obwire bwa backup nibukyendeera.
- Ekicuucu n'eky'okufaho. Omuti nari tanka y'amaizi ebirikuteera ekicuucu aha kicweka kya panel nibibaasa kukyendeeza munonga ebi zirikukora. Kihandiikire omufundi.
- Ebicweka nibikura. Battery ziine omubaro gw'emirundi (cycles) ogutarikurenga, kandi obuhango bwazo nibukyendeera emyaka ku erikuhinguraho. Panel nizifeerwa kakye aha maani gaazo buri mwaka. Gamba warranty eri aha kintu, etari ei orikwijuka.
- Ebi orikusigaza nibirugiirira aha nkoresa. Eki omukiriya arikusigaza nikirugiirira aha bi arikukoresa nyomushana, ebeeyi ya yunit (tariff), n'oku arikutwaza sisitemu ku erikuheza kuteebwaho.

## Ekiragiro omu Solar Switch
Okubara (sizing) kwa app n'okubara kwonka, ti pulaani ehamiibwe omukugu. Okuhitsya omufundi yaaheza kukebera pulaani, byona ebi orikworeka n'eby'okureeberaho. Gamba ngu "oku n'okuteebereza oku omufundi waitu araahamye", kandi otarigira ngu "eki nikiraganisibwa buzima (guaranteed)".`
      }
    ],
    questions: [
      {
        key: "m1-q1",
        prompt: "Omukiriya naakoresa freezer ya 200 W kumara eshaaha 10. Egyo ni energy erikwingana ki?",
        options: ["2 kWh, nizo yunit 2", "200 kWh", "Yunit 20", "Yunit 2,000"],
        explanation: "200 W x eshaaha 10 = 2,000 Wh = 2 kWh, kandi yunit emwe ni kWh emwe."
      },
      {
        key: "m1-q2",
        prompt: "Ni mubaro ki ogurikukira kworeka obuhango bwa inverter?",
        options: [
          "Yunit zoona ezirikukoresibwa omu kwezi",
          "Amaani agarikukirayo agarikukora omu bwire bumwe, otwariiremu n'okutandika kwa motor",
          "Omubaro gw'ebishengye by'enju",
          "Obuhango bw'ahaiguru y'enju"
        ],
        explanation: "Inverter eine kuha peak load kandi egumire surge y'okutandika. Energy niyo erikworeka panel na battery."
      },
      {
        key: "m1-q3",
        prompt: "Battery ya 48 V, 100 Ah neebiika energy nk'erikwingana ki?",
        options: ["480 Wh", "4,800 Wh", "148 Wh", "48,000 Wh"],
        explanation: "Energy = voltage x amp-hours: 48 x 100 = 4,800 Wh. Ekicweka kyayo kyonka nikyo kishemereire kukoresibwa."
      },
      {
        key: "m1-q4",
        prompt: "Omukiriya aine amasharaazi ga UEDCL agarikwesigwa kandi naayenda kukyendeeza biiru mpango ya nyomushana. Naatoorana grid-tied etaine battery. Oine kumugambira ki?",
        options: [
          "Neegumya amataara nigaaka amasharaazi ku garikugyenda",
          "Terikuha masharaazi obu aga UEDCL garikuba gagyenzire",
          "Terikwetenga mufundi kugikebera",
          "Neekora gye munonga nyekiro"
        ],
        explanation: "Sisitemu ya grid-tied etaine battery neeraara amasharaazi ga UEDCL ku garikugyenda."
      },
      {
        key: "m1-q5",
        prompt: "Amasharaazi aha irwariro nigagyenda ebiro ebirikukira obwingi, kandi nibenda kukyendeeza sente na backup. Ni muringo ki gwa sisitemu ogw'okutandikiraho?",
        options: ["Grid-tied", "Backup yonka", "Hybrid", "Tihaine sisitemu"],
        explanation: "Hybrid neekyendeeza sente ahabwa solar kandi eha backup ya battery, grid eri ey'okuhwera."
      },
      {
        key: "m1-q6",
        prompt: "Oshemereire kushoboorora ota ebiruga omu kubara (sizing) ebi omufundi atakakebeire?",
        options: [
          "Nka pulaani erikuraganisibwa buzima",
          "Nk'okuteebereza oku omufundi araahamye",
          "Nka quotation y'obutongore ey'aha muheru",
          "Toshemereire kubyoreka omukiriya na kakye"
        ],
        explanation: "Byona n'eby'okureeberaho okuhitsya omufundi yaahamya pulaani."
      }
    ]
  },
  {
    key: "m2",
    title: "Okushanga n'okushwijuma abarikubaasa kuba abakiriya (leads)",
    summary:
      "Abarikukira kugasirwa solar, ahu orikubashanga, n'oku orikumanya omu bibuuzo bikye yaaba lead eshemereire kushwijumirwa ebyetengo.",
    lessons: [
      {
        key: "m2-l1",
        title: "Abarikukira kugasirwa",
        body: `Ti buri muntu arikwetenga ekintu nikyo kimwe, kandi abantu abamwe tibakeetengire solar. Sherura ekizibu kya buzima eki solar erikumaraho.

## Abarikubaasa kugura munonga
- Abantu abarikushashura sente nyingi aha masharaazi buri kwezi kandi bakakoresa maingi nyomushana.
- Amaka na bizinensi ahu amasharaazi garikugyenda kaingi: okugyenda kwago nikubafeereza eby'okuguza, abakiriya nari obusingye.
- Emyanya etakwatsirwe ahari grid, nari ahu okugikwatsaho kurikutwara sente nyingi okukira sisitemu ya solar.
- Bizinensi ezirikukoresa amasharaazi nyomushana obutoosha: saluuni, amarwariro, amaduuka g'emibazi, amashomero, ofiisi, amaduuka againe firiiji na freezer, amafaamu againe pampu nari ebyoma by'okusa.
- Abantu abaine solar etakimara byetengo byabo. Nikyanguha kugamba nabo ahabw'okuba nibagiikiririzamu.

## Abatarikukira kubaasa kugura
- Abarikukoresa makye munonga kandi baine amasharaazi agarikwesigwa. Backup nkye neebaasa kubahwera, kwonka gamba amazima aha bi baraasigaze.
- Abantu abarikwenda ngu solar ekorese ebyoma by'okutagatsya ebirikusika maingi ekiro kyona, baine sente nkye. Shoboorora eki ekyo kirikwetenga otakagumiizemu.
- Abapangisa abataine rusa ya nyin'enju (landlord). Banza omareho eky'orusa.

Omuntu murungi orikushanga leads tarikugyemesereza buri muntu solar. Nooronda omuntu oine ekizibu ekirikumutwarira sente nyingi, reero omureetera eky'okukimaraho ekirikumushemerera.`
      },
      {
        key: "m2-l2",
        title: "Ahu leads zirikuruga",
        body: `Okuguza kwingi nikutandikira omu kuganiira oku waabaire oinemu.

## Abantu abu orikumanya
Ab'eka, abataahi, ekibiina kyanyu ky'okubiika sente, ahu orikushabira, eishomero ryawe erya ira, abashuubuzi abu orikuguraho. Bagambire eki orikukora, obabuuze ekibuuzo kimwe: "Amasharaazi nigakutwarira sente zingahi, kandi nigagyenda?"

## Abakurangiriire (referrals)
Omukiriya oshemereirwe niwe nshuro yaawe erikukirayo. Bwanyima ya buri kuteekaho sisitemu, mubuuze ondiijo ou arikumanya oine ekizibu nikyo kimwe, kandi omushabe orusa kugamba eiziina rye.

## Emyanya ahu ekizibu kirikureebeka
- Eduuka erikukoresa jenereeta.
- Oruguuto orurikuba omwirima amasharaazi ku garikubaganisibwa (load-shedding).
- Saluuni nari eirwariro ebirikugarura abakiriya amasharaazi ku garikugyenda.
- Ebyombeko bisya n'amataka agarikwombekwaho.
- Amafaamu n'amashomero agari hare na grid.

## Okukebera amasharaazi okw'abantu boona
Solar Switch eine orupapura rw'abantu boona ahu omuntu weena arikubaasa kubara amasharaazi agu arikukoresa akareeba sisitemu za solar zitaine beeyi, n'okukebera okwa kabiri okw'abantu abaine solar. Bagabire link. Omuntu orikukiheza akashaba quotation naahika omu app nk'okushaba kwa quotation, emibaro ye yaijwizemu.

## Kuratiriza
Abantu baingi tibarikucwamu omurundi gw'okubanza. Mwikirizane obu muraagarukye kugamba, kihandiikye, kandi ohikiirize eki ogambire. Okukuratiriza okurikwesigwa nikuguza bingi okukira ebigambo by'obwengye.`
      },
      {
        key: "m2-l3",
        title: "Okushwijuma lead omu bibuuzo bitaano",
        body: `Otakamazire shaaha nooshwijuma ebyetengo, manya yaaba lead egi n'eya buzima. Ebibuuzo bitaano nibimara.

## 1. Nooyenda kuha ki amasharaazi?
Hurikiza ebyoma n'ekizibu ekiri enyima yaabyo. "Ebiri omu firiiji yangye nibisiisikara" n'ensonga y'amaani okukira "ninyenda kumanya kwonka".

## 2. Amasharaazi gaawe ga UEDCL gari gata?
Nigeesigwa, nigagyenda kaingi, nari tokwatsirweho. Eki nikyoreka grid-tied, hybrid, backup nari off-grid.

## 3. Hati nookoresa ki nari nooshashura ki?
Yunit omu kwezi, sente za Yaka, nari amafuta ga jenereeta. Ku baraabe batarikumanya, okukebera amasharaazi nikukibara kuruga aha byoma byabo nari aha butumwa bwabo bwa token.

## 4. Ekibanja kiri nkahi, kandi n'oha orikucwamu?
Nooyetenga kumanya ahantu ngu haije kureebwa. Kandi nooyetenga kumanya yaaba noogamba n'omuntu orikucwamu kandi orikushashura, nari yaaba ou bashweraine nawe, nyin'enju, boodi nari ofiisi enkuru baine kubanza kwikiriza.

## 5. Ni ryari, kandi nooza kushashura ota?
Hati, omu myezi mikye, nari naareeba kwonka. Sente zoona omurundi gumwe (cash), nari mporampora (instalments). Otabateeberereza sente ezi baine kandi otaraganisa kuheebwa bbanja eritakaikiriziibwe.

## Reero cwamu
- Ayetebeekaniise: tebeekanisa okushwijuma ebyetengo.
- Tikikahikire: mwikirizane eizooba ry'okumukuratiriza.
- Tikirikumushemerera: kimugambire n'embabazi. Naija kwijuka ngu okamugambira amazima.`
      },
      {
        key: "m2-l4",
        title: "Okuhandiika lead n'okuha omukiriya ekitiinisa",
        body: `Lead etahandiikirwe eba ebuzire. Lead ehandiikirwe kubi neeshiisha obwire bw'omufundi.

## Gihandiikye eizooba eryo
Yongyeramu omukiriya, enamba ye y'esimu n'ahantu he, okuganiira kukiri kusya omu mutwe. Handiika ebi ohuriire, bitari ebi orikwenda ngu bibe: ebi arikukoresa, ebi arikushashura, ebi yaashaba. Handiika amaziina n'enamba z'esimu gye; omubaro gumwe ogushobire nigubuza okuguza.

## Banza oshabe otakatwaire
- Gamba ahabw'enki orikwenda enamba yaabo y'esimu, kandi ngu kampuni neija kubahikirira aha bi baabuuza.
- Biika GPS y'ahantu omukiriya yaaba aikiriize kwonka. App neekushaba kuhamya eki.
- Teera ebishushani by'ebyoma nari eby'ebyapa byabyo oheirwe orusa kwonka.

## Rinda ebi orikutwara
Amaziina g'abakiriya, enamba z'esimu, ahu bari n'ebi baine n'amakuru gaabo ag'omuntu. Eiteeka rya Uganda, Data Protection and Privacy Act, 2019, niryenda ngu amakuru nk'ago gatwarwe ahabw'ekigyendererwa ekirikumanywa gye kandi gabiikwe gye. Omu nkora:
- Biika ebirikukwata aha bakiriya omu app, bitari omu butabo bwawe nari omu groups z'okuganiira ez'abantu boona.
- Otagambira omukiriya ebirikukwata aha mukiriya ondiijo, nari omuntu weena otari wa kampuni.
- Otakoresa enamba z'abakiriya aha kintu kyona okwihaho emirimo ya kampuni nabo.

## Hikiiriza eki oraganiise
Ku oraabe ogizire ngu "nitwija kukuteerera esimu Orwakataano rutakahwire", hamya ngu haine owaakikora. Okwesigwa nikyo kintu eki orikuguza buzima.`
      }
    ],
    questions: [
      {
        key: "m2-q1",
        prompt: "Ahari aba, n'oha orikukira kubaasa kugura?",
        options: [
          "Eka eine amasharaazi agarikwesigwa kandi erikukoresa makye munonga",
          "Eduuka ry'emibazi erikufeerwa ebiri omu firiiji buri murundi amasharaazi ku garikugyenda",
          "Omupangisa ou nyin'enju yaayangire kuteekaho ekintu kyona",
          "Omuntu orikwenda kumanya kwonka kandi otarikwenda kuha enamba y'esimu"
        ],
        explanation: "Eduuka ry'emibazi eine ekizibu ekirikutwara sente nyingi kandi ekirikugaruka, eki solar eine backup erikumaraho."
      },
      {
        key: "m2-q2",
        prompt: "Obutoosha leads ensya nookira kuzitunga nkahi?",
        options: [
          "Okuteera esimu abantu abu otarikumanya",
          "Abakiriya abashemereirwe abarikukurangirira abandi",
          "Okugura enkarara z'enamba z'esimu",
          "Okutegyerereza aha ofiisi"
        ],
        explanation: "Omukiriya oshemereirwe ku arikukurangirira, naareeta abantu abaine ekizibu nikyo kimwe kandi abarikukwesiga."
      },
      {
        key: "m2-q3",
        prompt: "Ahabw'enki noobuuza ngu \"n'oha orikucwamu?\" ku orikuba nooshwijuma lead?",
        options: [
          "Kwetantara kuza kureeba ahantu",
          "Ahabw'okuba omuntu ou orikugamba nawe naabaasa kuba atari we orikwikiriza kandi orikushashura",
          "Kwongyera ebeeyi",
          "Ahabw'okuba app neekyetenga hatakabaireho kubara sisitemu"
        ],
        explanation: "Ou bashweraine nawe, nyin'enju nari boodi ku baraabe baine kwikiriza, nooyetenga ngu babe omu kuganiira quotation etakakozirwe."
      },
      {
        key: "m2-q4",
        prompt: "Omukiriya tarikumanya yunit zingahi ezi arikukoresa. Ni ki ekirikukira oburungi eky'okukurataho?",
        options: [
          "Teebereza omubaro ngu quotation ereebekye nk'erikubaasika",
          "Mugambire ngu solar terikumushemerera",
          "Kibare n'okukebera amasharaazi kuruga aha byoma bye nari aha butumwa bwe bwa token",
          "Guruka ekibuuzo ekyo"
        ],
        explanation: "Okukebera amasharaazi nikuteebereza ebi arikukoresa buri izooba kuruga aha rukarara rw'ebyoma nari aha butumwa bwa token."
      },
      {
        key: "m2-q5",
        prompt: "Noobaasa kubiika GPS y'ahantu h'omukiriya ryari?",
        options: [
          "Obutoosha, neehwera omufundi",
          "Omukiriya yaaba aikiriize kwonka",
          "Aha bakiriya ba bizinensi bonka",
          "Tikiribaho"
        ],
        explanation: "GPS n'amakuru g'omuntu, kandi neebiikwa yaaba aikiriize kwonka; app neekushaba kukihamya."
      },
      {
        key: "m2-q6",
        prompt: "Munywani waawe orikuguza jenereeta naakushaba enamba z'esimu za leads zaawe eza juba. Nookora ki?",
        options: [
          "Ozimuhe, ahabw'okuba ni munywani waawe",
          "Omuhe ez'abakiriya ba bizinensi zonka",
          "Oyangye: ebirikukwata aha mukiriya nibikoresibwa aha mirimo ya kampuni n'omukiriya ogwo yonka",
          "Ozimuguze"
        ],
        explanation: "Enamba z'abakiriya n'amakuru g'omuntu agatwairwe ahabw'ekigyendererwa kimwe, kandi tigashemereire kuheebwa abandi."
      }
    ]
  },
  {
    key: "m3",
    title: "Okushwijuma ebyetengo na Solar Switch",
    summary:
      "Oku orikuganiira n'omukiriya ahantu he, okukora okushwijuma ebyetengo (assessment), okukebera sisitemu eriho n'okuhika aha quotation y'okureeberaho omu app.",
    lessons: [
      {
        key: "m3-l1",
        title: "Okuganiira ahantu h'omukiriya",
        body: `Okushwijuma ebyetengo okurungi n'okuganiira okw'obwegyendesereza. Sisitemu neehikaana kwingana n'orukarara oru orikugaruka narwo.

## Gyenda omu kibanja kyona
Gyenda ekishengye aha kishengye n'omukiriya, ohandiikye ebirikukoresa amasharaazi. Abantu nibeebwa pampu y'amaizi, amataara g'oburinzi, firiiji ya kabiri na chaaja z'esimu okuhitsya babireebire.

## Ahari buri kyoma, handiika ebintu bina
- Ni bingahi.
- Amaani gaakyo omu watts. Shoma ekyapa ky'ekyoma (nameplate) ahu orikubaasa. Omubaro oguruga aha kyapa nigukira ogwa butoosha, kandi app neehandiika ogu wakoresa.
- Eshaaha zingahi ezi kirikukora buri izooba, n'obwire ki bw'eizooba. Ebi kirikukoresa nyomushana nibibaasa kuruga butunu omu panel; ebya nyekiro biine kuruga omu battery.
- Yaaba n'eky'omugasho munonga (critical), ekirikumanyisa ngu kiine kuguma nikikora amasharaazi ku garikugyenda.

## Yetegyereze motor
Firiiji, freezer, pampu, compressor n'ebyoma by'okusa nibigira surge ku birikutandika. Handiikamu surge ekyapa ku kirikugyoreka, nari ogambire omufundi motor ku eri.

## Reeba ahu oyehinguririize
- Panel nizibaasa kuza nkahi? Ahaiguru y'enju hareebire rubaju ki, kandi ni ki ekirikuhateeraho ekicuucu?
- Inverter na battery nibibaasa kuteebwa nkahi: ahoomire, ahariho omuyaga, aharinzirwe?
- Hariho sisitemu eriho, jenereeta, nari changeover switch?

Handiika ebi orikureeba. Eshaaha na watts ebi omukiriya arikukugambira n'okuteebereza; kigambe omu bi orikuhandiika ngu omufundi amanye ebikyetenga kukebebwa.`
      },
      {
        key: "m3-l2",
        title: "Okukora okushwijuma ebyetengo n'okubara sisitemu (sizing)",
        body: `Omu Solar Switch entebeekanisa neeguma eri emwe: omukiriya, ahantu, okushwijuma ebyetengo, okubara sisitemu.

## Okushwijuma ebyetengo
Igura omukiriya, otoorane ahantu, otandikye okushwijuma. Yongyeramu buri kyoma n'omubaro gwakyo, amaani, eshaaha n'obwire obu kirikukoreramu, reero oteekye akamanyiso aha by'omugasho munonga. Toorana omuringo gwa sisitemu. Sisitemu ya hybrid nari eya backup neeyetenga eshaaha za backup ezirikwendwa; eya off-grid neeyetenga ebiro ebi erikubaasa kwemera yonka. Heza okushwijuma orukarara ku rurikuba ruhikire.

Eki noobaasa kukikora otaine network. Ebi obiikire otari aha internet nibiguma biri draft aha simu yaawe okuhitsya byayeyohereza (sync).

## Okubara sisitemu (sizing)
Sizing neetwara okushwijuma okuhwaire n'orukarara rw'ebintu bya kampuni, reero ereeta enteekateeka (configurations): inverter, panel na battery ebirikuhikaana hamwe. Buri nteekateeka neeyoreka ebikebeirwe byayo:
- Kyaraba: ebirikukwata aha kintu nibihikiiriza ekirikwetengwa.
- Kyagwa: tikirikuhikaana. Enteekateeka egyo terikuheebwa.
- Nikyetenga kukebebwa: haine ekitarabaasize kuhamibwa, kaingi ahabw'okuba haine omubaro ogutariho nari hariho ekirikwetenga okucwamu kw'omukugu. Omufundi wenka niwe arikubaasa kumaraho ebi.

"Tikirikubaasa kuhamibwa" tikirikumanyisa ngu "obundi ni kirungi". Nikimanyisa ngu omufundi aine kureeba.

## Ku haraabe hataine ekirikuhikaana
Sizing neekugambira ahabw'enki: tihaine kintu kihango ekirikumara, voltage etarikuhikaana, nari emibaro etariho. Otakyetantara orikwetooranira ebintu wenka. Ensonga gigambire omufundi nari orikureeberera sitoowa (inventory administrator).`
      },
      {
        key: "m3-l3",
        title: "Abakiriya abaine solar",
        body: `Abakiriya baingi baine sisitemu kandi nibenda ebirikukiraho: backup erikumara obwire buraingwa, panel ezindi, inverter mpango. Okukebera okwongyera sisitemu (upgrade check) omu Solar Switch nikubara ebirikuhikaana n'ebyoma ebi baine.

## Shoma ebyapa
Handiikamu ebiri aha byapa by'ebyoma, bitari ebi omukiriya arikwijuka:
- Voltage ya sisitemu, niyo voltage ya bank ya battery: obutoosha 12, 24 nari 48 V.
- Inverter: amaani gaayo omu watts, na panel yaaba nizikwatwa butunu ahariyo.
- Charge controller, ku eraabe eriho eri yonka: MPPT nari PWM, amps zaayo na voltage ya solar erikukirayo ei erikwikiriza.
- Panel: ni zingahi, watts zaazo, na zingahi ezikwatsirwe omu buri string.
- Battery: ni zingahi, voltage na Ah zaazo, omuringo gwazo (chemistry) n'emyaka yaazo.

Ku oraabe otarikubaasa kushanga omubaro, gureke gutarimu kintu. Okukebera nikuteeka aha kicweka ekyo ngu "nikyetenga kukebebwa" omu mwanya gw'okuteebereza.

## Ebiragiro ebi okukebera kurikukuratira
- Ekirikwongyerwaho kyona kiine kuhikaana na voltage ya sisitemu. Sisitemu ya 24 V terikubaasa kutwara battery ya 48 V kityo.
- Battery z'emiringo (chemistry) erikutaana tizirikuba omu bank emwe na kakye. Lithium neeheebwa nk'erikuhingisa bank ya lead-acid, etari ey'okugyongyeraho.
- Battery ensya za lead-acid ezikwatanisiibwe na bank enkuru nizisikwa ahansi okuhika aha mbeera yaayo. Aha bank ekuzire, okugihingisa nikyo kirikukira obutoosha.
- Panel ezindi ziine kuhika omu voltage ei controller nari inverter erikwikiriza n'omu maani agu etarikurenga. Ku eraabe eijwire, okukebera nikuha controller nari inverter mpango hamwe na panel.

## Obutoosha
Ebyoma ebiriho tibikakebeirwe kampuni. Omufundi aine kuhamya emibaro yaabyo quotation yoona eruga omu kukebera okwongyera sisitemu etakaikiriziibwe.`
      },
      {
        key: "m3-l4",
        title: "Kuruga aha kubara sisitemu okuhika aha quotation y'okureeberaho",
        body: `Quotation omu Solar Switch neeraba omu ntambwe ezitarikuhinduka. Okuzimanya nikukubaasisa kugambira omukiriya butunu ekirikukurataho.

## 1. Draft
Nookora quotation kuruga aha nteekateeka ya sizing nari kuruga aha kukebera okwongyera sisitemu. App neeteeka ebeeyi aha buri kintu kuruga omu rukarara rw'ebintu. Noobaasa kwongyeraho obuheereza nk'okuteekaho sisitemu.

## 2. Ey'okureeberaho
Noobaasa kworeka nari kwohereza omukiriya quotation y'okureeberaho ahonaaho. Buri rupapura ruriho ebigambo "UNVERIFIED - FOR ILLUSTRATION ONLY" (TIKIKAHAMIIBWE - N'EKY'OKUREEBERAHO KWONKA). N'ekirikubahwera kucwamu, ti kiraganiso ky'okuguza.

## 3. Okukebebwa kw'omufundi
Noogyohereza. Omufundi naakebera ebyoma ebirikukoresa amasharaazi, battery, panel, inverter n'ebihandiikirwe ahari ahantu, naakoresa orukarara rw'eby'okukebera, reero agiikiriza, agigarura ngu ehindurwe, nari agyanga. Torikubaasa kwikiriza pulaani yaawe wenka.

## 4. Okwikirizibwa kw'eby'obushuubuzi
Nikwetengwa ebeeyi ku eri ahansi y'ebeeyi y'ahansi eikiriziibwe (floor) nari quotation ku eine endagaano ezitari za butoosha kwonka. Maneja niwe arikucwamu.

## 5. Okuheebwa omu butongore
Revision eikiriziibwe yonka niyo erikubaasa kuheebwa. App neegiha enamba y'obutongore n'eizooba eri erikuhwaho, kandi egibiikira ebintu (stock).

## Ku haraabe haine ekyahinduka
Okuhindura ebintu, emibaro yaabyo, ebeeyi nari endagaano nikukora revision ensya, kandi okwikirizibwa kw'enyima tikukikora. Ekyo nikikurinda n'omukiriya: ekyaikirizibwa nikyo kyonyini ekirikuheebwa.

Gambira omukiriya amazima aha ku ahikire: "Oku n'okuteebereza kwaitu. Omufundi waitu naakukebera, reero otungye quotation y'obutongore."`
      }
    ],
    questions: [
      {
        key: "m3-q1",
        prompt: "Ni nkahi aharikukira oburungi ah'okwiha amaani g'ekyoma omu watts?",
        options: [
          "Ebi omukiriya arikwijuka",
          "Ekyapa ekiri aha kyoma (nameplate)",
          "Ekyoma ky'omutaahi ekirikushushana nakyo",
          "Omubaro gwona ogurikugumya sisitemu eri nkye"
        ],
        explanation: "Omubaro gw'aha kyapa nigukira ogwa butoosha nari ogurikwijukwa, kandi app neehandiika ahu guruga."
      },
      {
        key: "m3-q2",
        prompt: "Ahabw'enki obwire bw'eizooba obu ekyoma kirikukoreramu n'obw'omugasho?",
        options: [
          "Ti bw'omugasho",
          "Ebirikukoresibwa nyomushana nibibaasa kuruga butunu omu panel, kandi ebya nyekiro biine kuruga omu battery",
          "Ebyoma nibikoresa amasharaazi makye nyekiro",
          "Ebeeyi ya yunit obutoosha eba eri ahansi nyekiro"
        ],
        explanation: "Ebirikukora nyekiro nibyo birikworeka obuhango bwa battery; ebya nyomushana nibibaasa kuheebwa solar butunu."
      },
      {
        key: "m3-q3",
        prompt: "Ekikebeirwe omu sizing nikyoreka \"nikyetenga kukebebwa\". Ekyo nikimanyisa ki?",
        options: [
          "Obundi ni kirungi, gumizamu",
          "Enteekateeka egwire",
          "Omufundi aine kukihamya; tikirikubaasa kutwarwa nk'ekiraabire",
          "Omukiriya aine kubanza kushashura deposit"
        ],
        explanation: "Haine ekitarabaasize kuhamibwa. Omufundi wenka niwe arikubaasa kukimaraho."
      },
      {
        key: "m3-q4",
        prompt: "Omukiriya oine bank ya lead-acid ya 48 V naayenda backup erikumara obwire buraingwa kandi naakunda lithium. Okukebera okwongyera sisitemu nikumuha ki?",
        options: [
          "Okwongyeraho battery emwe ya lithium aha rubaju rw'eza lead-acid",
          "Okuhingisa bank na lithium, ahabw'okuba emiringo erikutaana terikuba omu bank emwe",
          "Okuhindura sisitemu ekaba 12 V",
          "Tihaine; lithium terikubaasa kukoresibwa aha sisitemu eriho"
        ],
        explanation: "Emiringo ya battery terikutaburwa omu bank emwe. Lithium neeheebwa nk'erikuhingisa bank yoona."
      },
      {
        key: "m3-q5",
        prompt: "Torikubaasa kushanga voltage ya solar erikukirayo aha charge controller enkuru. Noohandiika ki omu kukebera okwongyera sisitemu?",
        options: [
          "Omubaro gwa butoosha oguruga aha controller endiijo",
          "Omubaro ogurikukirayo ogurikwikirizibwa",
          "Kireke kitarimu kintu, ngu ekicweka ekyo kiteebweho akamanyiso omufundi akihamye",
          "Voltage ya battery"
        ],
        explanation: "Omubaro ogutariho nigumanyisa ngu \"tikirikubaasa kuhamibwa\". Otarihimba mubaro."
      },
      {
        key: "m3-q6",
        prompt: "Ni ki ekiine kureebeka aha buri rupapura rwa quotation etakaikiriziibwe kandi etakahairwe omu butongore?",
        options: [
          "Commission y'omutunzi",
          "\"UNVERIFIED - FOR ILLUSTRATION ONLY\" (TIKIKAHAMIIBWE - N'EKY'OKUREEBERAHO KWONKA)",
          "Ebeeyi y'ahansi eikiriziibwe (floor)",
          "Enamba y'esimu y'omufundi"
        ],
        explanation: "Quotation z'okureeberaho obutoosha ziteebwaho akamanyiso ngu zitaritwarwa nk'ekiraganiso ky'obutongore."
      }
    ]
  },
  {
    key: "m4",
    title: "Okworeka proposal, okuhendera okuguza n'okuguza omu mazima",
    summary:
      "Oku orikworeka proposal, okugarukamu ebi abakiriya barikukira kuhakanisa, okuhendera gye okuguza n'okukuratira ebiragiro ebirikurinda omukiriya na kampuni.",
    lessons: [
      {
        key: "m4-l1",
        title: "Okworeka proposal",
        body: `Omukiriya tarikwenda panel. Naayenda amataara agarikuguma nigaaka, eby'okuguza ebitarikusiisikara, nari biiru nkye. Mworekye eky'okumaraho ekizibu kye.

## Tandikira aha bi yaakugambiire
"Okagira ngu nooshashura nk'ezi buri kwezi kandi amasharaazi nigagyenda emihingo erikukira obwingi." Yoreka ngu okahurikiza otakoreekire beeyi.

## Yoreka erizooba na nyenkyakare
Koresa emibaro eruga omu kushwijuma ebyetengo: ebi arikukoresa buri izooba, ebi birikumutwarira hati, ebi sisitemu eraamuhe, n'obwire obu backup erikumara aha byoma bye by'omugasho munonga. Koresa emibaro eri aha quotation. Otayongyeraho emirungi eruga omu mutwe gwawe.

## Shoboorora ebirimu
Raba omu nyiriri: panel, inverter, battery, mounting, eby'oburinzi, waya, okuteekaho. Shoboorora warranty ya buri kintu nk'oku ehandiikirwe. Ku haraabe haine ekitarimu, kigambe hati, etari bwanyima y'okushashura.

## Muhe eky'okutooranamu ahu kiri
Abakiriya nikibanguhira kucwamu ahagati y'ebintu bibiri okukira ahagati ya eego na ngaaha: nk'eky'okureeberaho, sisitemu y'ebyoma by'omugasho munonga hati, eine omwanya gw'okwongyeraho panel nari battery bwanyima.

## Gamba ahu ehikire
Quotation ku eraabe eri ey'okureeberaho, gamba ngu ekiine kuhamibwa omufundi kandi ngu quotation y'obutongore neekurataho. Abakiriya nibaha ekitiinisa enkora erikwetegyerezibwa.

Reero ohuname, obareke babuuze ebibuuzo.`
      },
      {
        key: "m4-l2",
        title: "Okugarukamu ebi abakiriya barikukira kuhakanisa",
        body: `Okuhakana n'ekibuuzo eki omukiriya atakahwire kubuuza. Kigarukyemu omu mazima.

## "Neeseera munonga"
Gigyeragyeranise n'ebi barikushashura hati: amasharaazi ga buri kwezi, amafuta ga jenereeta, eby'okuguza ebirikusiisikara. Boreka okubara kw'okushashura mporampora (instalments) ku baraabe nibabaasa kukutunga. Bahe entambwe y'okubanza nkye erikubaasa kukura. Otakyendeeza ebeeyi okurenga ahu oikiriziibwe, kandi otaihamu bicweka by'oburinzi ngu ebe eya ebeeyi nkye.

## "Nimbaasa kugura ebicweka ebya ebeeyi nkye omu tauni"
Nikibaasika. Buuza ebirimu: ebaziirwe ebyoma byabo, ebicweka nibihikaana, n'oha orikugiteekaho, kandi n'oha orikugarukamu ku erikufa? Sisitemu ehikaine, ehamiibwe kandi eine warranty n'ekintu ekirikutaana n'ebicweka ebiguzirwe kimwe kimwe.

## "Solar terikukora enjura ku erikugwa"
Neekora makye omu biro by'omwirima, kandi nikyo sisitemu erikubarirwa n'eshaaha z'omushana z'okwegyendesereza. Aha sisitemu ya hybrid, grid neijuza ekirikuburaho. Gamba amazima: ebiro bingi by'obwire bubi nibikyendeeza ebi sisitemu yoona erikukora.

## "Battery nizifa juba"
Battery nizikura ku zirikukoresibwa. Obwire obu zirikumara niburugiirira aha muringo gwazo (chemistry), oku zirikukoresibwa okuhika ahansi, n'emirundi (cycles) ei abaazikozire barikugamba. Boreka emibaro eri aha kintu, oshoboorore oku sisitemu ebaziirwe kuguma omuriyo.

## "Reka nkiteekateekyeho"
Ekyo kihikire. Buuza eki barikwenda kuteekateekaho, okigarukyemu ku oraabe noobaasa, mwikirizane eizooba ry'okugaruka kugamba. Reero obakuratirize aha izooba eryo.

Otarigarukamu okuhakana n'ekiraganiso eki quotation etarikuha.`
      },
      {
        key: "m4-l3",
        title: "Okuhendera okuguza na bwanyima y'okwikiriza",
        body: `Okuhendera okuguza n'okushaba omukiriya kucwamu ku arikuba aine byona ebi arikwetenga kucwamu.

## Buuza butunu
"Tugumizemu n'eki?" Eky'okugarukamu ku kiraabe kiri ngu tikikahikire, manya ekirikuburaho: omubaro, omuntu oine kwikiriza, nari sente.

## Kihandiikye gye
- Quotation ehairwe omu butongore yonka niyo erikubaasa kwikirizibwa. Omukiriya ku arikwikiriza ey'okureeberaho, entambwe yaawe erikukurataho n'okugitwara ekebebwe kandi eheebwe omu butongore.
- Handiika okwikiriza omu app. Ekyo nikiigura omurimo gw'okuteekaho sisitemu kandi kibiikira omukiriya ebintu.
- Emiringo y'okushashura, deposit n'okushashura mporampora n'ebyo ebi kampuni eikiriize. Otaikirizana ntebeekanisa zaawe wenka.
- Omukiriya ku arikwanga, nakyo kihandiikye, hamwe n'ensonga. Nikyegyesa tiimu yoona.

## Sisitemu etakateirweho
Hamya eizooba, oraabe ahantu, ahu ebyoma biraaze na kyona eki omukiriya aine kutebeekanisa. Gambira omufundi byona ebi wayegire omu kutaayaaya kwawe.

## Aha kukwatsa omukiriya sisitemu
Hamya ngu omukiriya yaayorekwa oku arikushoma inverter, ebi sisitemu erikubaasa n'ebi etarikubaasa kukoresa, eky'okukora haaba haine ekyafa, n'ou arikuteerera esimu. Garuka oshoboorore warranty.

## Bwanyima
Teera esimu bwanyima ya saabiiti na bwanyima y'okwezi. Omukiriya orikuhurira ngu naafiibwaho naakuha leads zaawe ishatu ezirikukurataho. Mushabe akurangirire abandi, kandi oshabe orusa kukoresa eiziina rye.`
      },
      {
        key: "m4-l4",
        title: "Ebiragiro ebi otarikuhenda na kakye",
        body: `Ebiragiro ebi nibirinda omukiriya, kampuni naiwe. Tibirikuhindurwa, n'obu okuguza kwakuba kuri haihi kuhwa.

- Otaryoreka quotation y'okureeberaho nk'ey'obutongore, kandi otariihaho nari okashereka akamanyiso ka "UNVERIFIED".
- Otariraganisa kusigaza sente, eshaaha za backup nari enkora ebitari aha quotation.
- Otarihimba mubaro nari okagambira omukiriya ngu ebicweka nibihikaana app ku erikugira ngu terikubaasa kubihamya.
- Otariikiriza pulaani yaawe wenka. Okwikiriza kw'eby'obufundi n'okw'omufundi otari mukama wa quotation.
- Otariha discount erikurenga obushoboorozi bwawe. Ebeeyi eri ahansi ya floor neeyetenga okwikiriza kwa maneja.
- Otariraganisa bintu (stock) nari eizooba ry'okureeta ebi sisitemu etakahamize. Ebintu nibibiikwa quotation ku erikuheebwa omu butongore kwonka.
- Otarigyemesereza nari okabeiha. Hatabaho biro by'ebishuba by'okuhwaho, okutiinisa abantu, nari okushereka sente.
- Otariikiriza kushashurwa aheeru y'enkora eikiriziibwe kampuni.
- Otarigabira bandi nari okakoresa kubi amakuru g'abakiriya.
- Ku oraareebe ekintu ekitari kirungi aha by'oburinzi ahantu, nka waya ezishiisikaire, battery ezoseize munonga nari ahakwatanisiibwe hari aheeru, gambira omukiriya kandi okitwarire omufundi.
- Ku oraabe otarikumanya eky'okugarukamu aha kibuuzo ky'eby'obufundi, kigambe, oreete omufundi.

## Ahabw'enki n'eky'omugasho
Omukiriya omwe owaagambiirwe amazima kandi akatunga ekyamuraganisiibwe naareeta bizinensi nyingi okukira ikumi abaaguziibwe n'ebigambo by'okurengyesereza. Omutunzi wa Solar Switch oine satifikeeti n'omuntu ou omukiriya arikubaasa kwikiriza.`
      }
    ],
    questions: [
      {
        key: "m4-q1",
        prompt: "Ni muringo ki ogurikukira oburungi ogw'okutandika kworeka proposal?",
        options: [
          "N'ebeeyi yoona hamwe",
          "N'emibaro y'eby'obufundi ya inverter",
          "Okugarukamu ekizibu eki omukiriya yaakugambiire",
          "Okugaya kampuni ezindi"
        ],
        explanation: "Tandikira aha kizibu kyabo ngu proposal ereebekye butunu ngu n'eky'okukimaraho."
      },
      {
        key: "m4-q2",
        prompt: "Omukiriya naagira ngu sisitemu neeseera munonga. Ni ky'okugarukamu ki ekirikwikirizibwa?",
        options: [
          "Ihamu breakers na surge protection okyendeeze ebeeyi",
          "Muhe discount yoona erikwetengwa ngu oguze erizooba",
          "Gyeragyeranisa n'ebi arikushashura hati, omuhe entambwe y'okubanza nkye erikubaasa kukura",
          "Raganisa ngu sisitemu neija kwegarurira sente zaayo omu myezi mukaaga"
        ],
        explanation: "Gigyeragyeranise n'ebi arikushashura hati, omuhe eky'okukora mporampora. Otariihamu bicweka by'oburinzi nari okarenga obushoboorozi bwawe bwa discount."
      },
      {
        key: "m4-q3",
        prompt: "Omukiriya naikiriza quotation y'okureeberaho kandi naayenda kushashura hati. Nookora ki?",
        options: [
          "Otware sente oteekyeho sisitemu",
          "Ogyohereze ekebebwe omufundi ngu ebanze eikirizibwe kandi eheebwe omu butongore",
          "Ohindure PDF oihaho akamanyiso (watermark)",
          "Ogiikirize wenka ngu otashiisha bwire"
        ],
        explanation: "Quotation ehairwe omu butongore yonka niyo erikubaasa kwikirizibwa. Eine kubanza kukebebwa n'okuheebwa."
      },
      {
        key: "m4-q4",
        prompt: "N'oha orikubaasa kuha quotation yaawe okwikiriza kw'eby'obufundi?",
        options: [
          "Iwe, ku oraabe noohamya",
          "Omukiriya",
          "Omufundi otari mukama wa quotation",
          "Omutunzi weena"
        ],
        explanation: "Omutunzi tarikubaasa kwikiriza pulaani ye wenka na kakye."
      },
      {
        key: "m4-q5",
        prompt: "Omukiriya naayenda ebeeyi eri ahansi y'ebeeyi y'ahansi eikiriziibwe (floor). Nihabaho ki?",
        options: [
          "Noobaasa kwikiriza okuguza ku kuraabe kuri kuhango",
          "Nikyetenga okwikiriza kw'eby'obushuubuzi kwa maneja",
          "Omufundi niwe arikucwamu",
          "App neekikora yonka"
        ],
        explanation: "Ebeeyi eri ahansi ya floor, n'endagaano ezitari za butoosha, nibyetenga okwikiriza kwa maneja."
      },
      {
        key: "m4-q6",
        prompt: "Omu kutaayaaya noreeba waya ezihiire aha sisitemu y'omukiriya eriho. Oshemereire kukora ki?",
        options: [
          "Kireke; ti sisitemu ei wateireho",
          "Kikore wenka",
          "Gambira omukiriya kandi okitwarire omufundi",
          "Kikoreese kutiinisa omukiriya ngu agure"
        ],
        explanation: "Ebizibu by'oburinzi nibigambwa omu mazima kandi bitwarirwa omufundi."
      }
    ]
  }
];
