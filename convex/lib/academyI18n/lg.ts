import type { ModuleTranslation } from "./index";

/** Draft translation of the built-in Sales Academy, to be checked by a native speaker. */
export const lg: ModuleTranslation[] = [
  {
    key: "m1",
    title: "Ebisookerwako ku solar n'amasannyalaze",
    summary:
      "Ebipimo, ebitundu bya sisitemu ya solar n'ebika bya sisitemu, osobole okunnyonnyola solar obulungi n'okulaba kasitoma kye yeetaaga.",
    lessons: [
      {
        key: "m1-l1",
        title: "Power, energy ne yuniti ya Yaka",
        body: `Bakasitoma boogera ku "yuniti" ne ku ssente ze basaasaanya ku Yaka. Okusobola okubayamba weetaaga okutegeera ebintu bibiri, era tobitabulatabulanga.

## Power: ekintu bwe kisika amasannyalaze n'amaanyi
Power (amaanyi) epimibwa mu watts (W). Bbalubu ya 10 W esika matono; bbinika ya 2,000 W esika mangi. 1,000 W ye kilowatt 1 (kW). Power y'esalawo inverter bw'erina okwenkana obunene, kubanga inverter erina okuwa amasannyalaze buli kintu ekiteereddwako mu kiseera kye kimu.

## Energy: power ekozeseddwa okumala ekiseera
Energy (amasannyalaze agakozeseddwa) epimibwa mu watt-hours (Wh) oba kilowatt-hours (kWh). Yuniti emu eya Yaka ye kWh emu.

Energy = power x essaawa. Ttivvi ya 100 W eteereddwako okumala essaawa 10 ekozesa 1,000 Wh, ye 1 kWh, ye yuniti 1. Energy y'esalawo panel mmeka ne bbaatule yenkana wa kasitoma by'ayetaaga.

## Ebirala bibiri by'olina okuwuliriza
- Peak load: ebisinga obungi ebikola omulundi gumu. Amaka gayinza okukozesa energy ntono mu lunaku naye ne gaba ne peak eya waggulu nga paasi, bbinika ne ppampu bikola awamu.
- Starting surge: firiigi, freezer, ppampu n'ebyuma ebirala ebirina motor bisika amaanyi agakubisaamu emirundi egiwera ku ge bikozesa bulijjo, okumala akaseera katono nga bitandika. Inverter erina okugagumira.

Kasitoma bw'agamba nti "Ngula yuniti 150 buli mwezi", ezo ziba nga 5 kWh buli lunaku. Omuwendo ogwo gwokka gukubuulira dda sisitemu ya bunene ki gye mulina okwogerako.`
      },
      {
        key: "m1-l2",
        title: "Ebitundu bya sisitemu ya solar",
        body: `Buli sisitemu gy'otunda ezimbibwa mu bitundu bye bimu ebitonotono. Manya buli kimu kye kikola n'omuwendo ki ku label yaakyo ogw'omugaso.

## Panel za solar
Zikola amasannyalaze okuva mu kitangaala ky'enjuba. Label eraga watts-peak (Wp), ge maanyi ge zikola mu musana ogutuukiridde. Mu nkola eya bulijjo zikola matono ku ago, y'ensonga lwaki mu kubalirira sisitemu tukozesa essaawa z'omusana ez'obwegendereza. Panel ziyungibwa emu ku ndala (series) ne zikola "string", era voltage ya string erina okukwatagana ne inverter oba charge controller.

## Inverter
Ekyusa amasannyalaze ga bbaatule n'aga solar (DC) n'egafuula amasannyalaze ebyuma ge bikozesa (AC). Label eraga amaanyi g'ewa obutasalako mu watts, era emirundi mingi n'omuwendo gwa surge ogusingako. Inverter nnyingi ziwandiikibwako kVA; omuwendo gwa watts gwe gw'ogeraageranya n'ebyuma bya kasitoma.

## Bbaatule
Zitereka amasannyalaze ag'okukozesa ekiro n'amasannyalaze bwe gavaako. Label eraga voltage (V) ne capacity mu amp-hours (Ah). Energy = V x Ah, n'olwekyo bbaatule ya 48 V 100 Ah ekwata nga 4,800 Wh. Si gonna nti galina okukozesebwa: bbaatule w'ekkirizibwa okukoma okuggwaamu kisinziira ku kika kyayo (chemistry) ne ku muwendo gw'abaagikola.

## Charge controller
Efuga engeri panel gye zicaajingamu bbaatule. Controller za MPPT ziggya bingi mu panel okusinga eza PWM. Inverter nnyingi eza hybrid zirina controller munda mu zo.

## Ebirala byonna
Ebikwata panel (mounting), waya, breaker, fuse, surge protection ne earthing. Tebisanyusa nnyo, naye sisitemu etabirina si ya bukuumi era si nzijuvu. Tobirekangayo olw'okwagala ebbeeyi erabike nga ya wansi.`
      },
      {
        key: "m1-l3",
        title: "Ebika bya sisitemu n'abo be zisaanira",
        body: `Solar Switch ekola n'ebika bya sisitemu bina. Okulonda ekituufu kutandika n'ekibuuzo kimu: amasannyalaze ga kasitoma aga grid (aga UEDCL) geesigika kwenkana wa?

## Grid-tied
Panel ne inverter nga tewali bbaatule. Ekendeeza bbiiru emisana. Tewa masannyalaze nga grid evuddeko, era ekyo olina okukyogera kaati. Esaanira bakasitoma abalina grid eyeesigika era abakozesa amasannyalaze mangi emisana.

## Hybrid
Panel, bbaatule n'okuyungibwa ku grid. Solar y'ekozesa ebyuma era n'ecaajinga bbaatule; grid y'eyamba nga solar temala. Esaanira amaka ne bizinensi grid gy'etera okuvaako, nga kasitoma ayagala okukekkereza era ne backup.

## Off-grid
Panel ne bbaatule nga tewali grid n'akatono. Sisitemu erina okusitula buli kimu, nga mw'otwalidde n'ennaku ez'ebire, n'olwekyo bbaatule zibalirirwa mu nnaku ze zisobola okumala nga tewali musana (days of autonomy). Esaanira ebifo ebitalina grid.

## Backup yokka
Inverter ne bbaatule ezicaajingibwa grid, nga tewali panel. Ekuuma ebyuma ebikulu nga bikola amasannyalaze bwe gavaako, naye tekendeeza bbiiru. Emirundi mingi panel zisobola okwongerwako oluvannyuma.

## Ebyuma ebikulu ennyo (critical loads)
Ku sisitemu za hybrid n'eza backup, buuza byuma ki ebirina okusigala nga bikola amasannyalaze bwe gavaako: amataala, firiigi, router, ekyuma kya till, ebyuma by'obujjanjabi. Okuwa backup ebyo byokka kikuuma bbaatule, n'ebbeeyi, nga bya kigero.`
      },
      {
        key: "m1-l4",
        title: "Solar ky'esobola n'ekyo ky'etesobola kusuubiza",
        body: `Bakasitoma beesiga agent ababuulira amazima. Bino bye bikomo by'onnyonnyola buli mulundi.

- Enjuba ekyukakyuka. Sisitemu zibalirirwa ku ssaawa z'omusana ez'obwegendereza zisobole okukola ne mu mwezi omubi, naye ennaku ez'ekizikiza n'enkuba eziddiriŋŋana zikendeeza sisitemu yonna ky'ekola.
- Bbaatule zirina we zikoma. Essaawa za backup zisinziira ku biteereddwako. Kasitoma bw'ayongera ekibugumya oba paasi ku sisitemu eyabalirirwa amataala ne firiigi, ebbanga lya backup likendeera.
- Ekisiikirize kikulu. Omuti oba ttanka y'amazzi ebisiikiriza ekitundu ku panel biyinza okukendeereza ddala ebikolebwa. Kiwandiikire omukugu.
- Ebitundu bikaddiwa. Bbaatule zirina omuwendo gw'emirundi (cycles) gye zisobola okucaajingibwa n'okukozesebwa, era capacity yaazo ekendeera emyaka bwe gigenda giyitawo. Panel zifiirwa akatono ku bye zikola buli mwaka. Yogera warranty eri ku kintu, so si gy'ojjukira.
- Okukekkereza kusinziira ku nkozesa. Kasitoma ky'akekkereza kisinziira ku bungi bw'amasannyalaze g'akozesa emisana, ebbeeyi ya yuniti (tariff), n'engeri gy'akozesaamu amasannyalaze oluvannyuma lw'okuteekebwako sisitemu.

## Etteeka mu Solar Switch
Okubalirira kwa app (sizing) kubala bubazi, si nteekateeka ekakasiddwa mu butongole. Okutuusa omukugu lw'amala okwekenneenya enteekateeka, buli ky'olaga kiba kya kulagirako bulagizi. Gamba nti "kuno kuteebereza omukugu waffe kw'ajja okukakasa", so togambanga nti "kino kikakafu ddala".`
      }
    ],
    questions: [
      {
        key: "m1-q1",
        prompt: "Kasitoma akozesa freezer ya 200 W okumala essaawa 10. Eyo energy yenkana wa?",
        options: ["2 kWh, ze yuniti 2", "200 kWh", "Yuniti 20", "Yuniti 2,000"],
        explanation: "200 W x essaawa 10 = 2,000 Wh = 2 kWh, era yuniti emu ye kWh emu."
      },
      {
        key: "m1-q2",
        prompt: "Muwendo ki ogusinga okusalawo inverter bw'erina okwenkana obunene?",
        options: [
          "Yuniti zonna ezikozesebwa mu mwezi",
          "Amaanyi agasinga agakozesebwa mu kiseera kye kimu, nga mw'otwalidde ne motor nga zitandika",
          "Omuwendo gw'ebisenge mu nnyumba",
          "Obunene bw'akasolya"
        ],
        explanation: "Inverter erina okuwa peak load n'okugumira surge ebyuma nga bitandika. Energy y'esalawo panel ne bbaatule."
      },
      {
        key: "m1-q3",
        prompt: "Bbaatule ya 48 V, 100 Ah ekwata energy nga yenkana wa?",
        options: ["480 Wh", "4,800 Wh", "148 Wh", "48,000 Wh"],
        explanation: "Energy = voltage x amp-hours: 48 x 100 = 4,800 Wh. Ekitundu kyokka ku yo kye kirina okukozesebwa."
      },
      {
        key: "m1-q4",
        prompt: "Kasitoma alina grid eyeesigika era ayagala okukendeeza bbiiru ennene ey'emisana. Alonda grid-tied nga tewali bbaatule. Kiki ky'olina okumubuulira?",
        options: [
          "Ejja kukuuma amataala nga gaaka amasannyalaze bwe gavaako",
          "Tewa masannyalaze nga grid evuddeko",
          "Teyetaaga mukugu kugyekenneenya",
          "Esinga kukola kiro"
        ],
        explanation: "Sisitemu ya grid-tied etalina bbaatule ezikira nga grid evuddeko."
      },
      {
        key: "m1-q5",
        prompt: "Grid ku kiliniki evaako ennaku ezisinga, era baagala okukekkereza ne backup. Kika ki ekya sisitemu eky'okutandikirako?",
        options: ["Grid-tied", "Backup yokka", "Hybrid", "Tewali sisitemu"],
        explanation: "Hybrid ekekkereza olwa solar era n'ewa backup ya bbaatule, nga grid y'eyamba nga bibuze."
      },
      {
        key: "m1-q6",
        prompt: "Ebivudde mu kubalirira (sizing) omukugu by'atannaba kwekenneenya obinnyonnyola otya?",
        options: [
          "Ng'enteekateeka ekakasiddwa ddala",
          "Ng'okuteebereza omukugu kw'ajja okukakasa",
          "Nga quotation entongole ey'enkomeredde",
          "Tolina kubiraga kasitoma n'akatono"
        ],
        explanation: "Buli kimu kiba kya kulagirako okutuusa omukugu lw'akakasa enteekateeka."
      }
    ]
  },
  {
    key: "m2",
    title: "Okuzuula abayinza okugula (leads) n'okubasunsula",
    summary:
      "Ani asinga okuganyulwa mu solar, gy'obasanga, n'engeri y'okumanya mu bibuuzo bitono oba lead agwanira okukolerwa assessment.",
    lessons: [
      {
        key: "m2-l1",
        title: "Ani asinga okuganyulwa",
        body: `Si buli muntu nti yeetaaga ekintu kye kimu, era abamu tebannaba kwetaaga solar. Noonya ekizibu ekya ddala solar ky'egonjoola.

## Abasuubirwa ennyo okugula
- Abantu abasaasaanya ssente nnyingi ku masannyalaze buli mwezi, era nga agasinga bagakozesa emisana.
- Amaka ne bizinensi amasannyalaze gye gatera okuvaako: okuvaako kubafiiriza ebintu bye batunda, bakasitoma oba emirembe.
- Ebifo ebitalina grid, oba okugiyungako gye kyandisinze ebbeeyi ya sisitemu ya solar.
- Bizinensi ezikozesa amasannyalaze agatakyukakyuka emisana: saluuni, kiliniki, amaduuka g'eddagala, amasomero, ofiisi, amaduuka agalina firiigi ne freezer, faamu ezirina ppampu oba ebyuma ebisa.
- Abantu abalina dda solar etakyamala byetaago byabwe. Kyangu okwogera nabo kubanga solar bagikkiririzaamu dda.

## Abatasuubirwa nnyo
- Abakozesa amasannyalaze matono ennyo era nga grid yaabwe yeesigika. Backup entono eyinza okubayamba, naye beera mwesimbu ku bye banaakekkereza.
- Abantu abaagala solar ekozese ebyuma ebibugumya eby'amaanyi ekiro kyonna ku ssente entono. Sooka obannyonnyole ekyo kye kyetaagisa nga temunneeyongerayo.
- Abapangisa abatalina lukusa lwa nnannyini nnyumba. Sooka mugonjoole eky'olukusa.

Omuntu omulungi mu kuzuula leads tapikiriza buli muntu solar. Onoonya omuntu alina ekizibu ekimufiiriza ssente, n'omuleetera eky'okuddamu ekimusaanira.`
      },
      {
        key: "m2-l2",
        title: "Leads gye bava",
        body: `Okutunda okusinga kutandika n'emboozi gye wali onyumya edda.

## Abantu b'omanyi
Ab'eŋŋanda, baliraanwa, ekibiina kyo eky'okutereka ssente, gy'osabira, essomero lye wasomeramu, abasuubuzi b'ogulako. Babuulire ky'okola obabuuze ekibuuzo kimu: "Amasannyalaze gakumalako ssente mmeka, era gavaako?"

## Abakusindikira abalala (referrals)
Kasitoma amatidde ye nsibuko yo esinga. Oluvannyuma lwa buli sisitemu eteekeddwawo, mubuuze abalala b'amanyi abalina ekizibu kye kimu, era omusabe olukusa okwogera erinnya lye.

## Ebifo ekizibu gye kirabikira
- Edduuka erikozesa generator.
- Oluguudo olukwata ekizikiza mu load-shedding.
- Saluuni oba kiliniki egoba bakasitoma ng'amasannyalaze gavuddeko.
- Ebizimbe ebipya n'amasiteeti agazimbibwa.
- Faamu n'amasomero ebiri ewala okuva ku grid.

## Okukebera amasannyalaze okw'olukale
Solar Switch erina omuko ogw'olukale buli muntu kw'asobola okubalirira amasannyalaze g'akozesa n'alaba sisitemu za solar ez'okulondako nga teziriiko bbeeyi, n'okukebera okw'okubiri okw'abantu abalina dda solar. Gabana link. Omuntu akumaliriza n'asaba quotation atuuka mu app ng'okusaba kwa quotation, ng'emiwendo gye gijjuziddwamu dda.

## Okugoberera (follow up)
Abantu abasinga tebasalawo ku mulundi ogusooka. Mukkiriziganye ddi lwe munaddamu okwogera, kiwandiike, era otuukirize ky'ogambye. Okugoberera okwesigika kuleeta okutunda kungi okusinga ebigambo ebiwoomu.`
      },
      {
        key: "m2-l3",
        title: "Okusunsula lead mu bibuuzo bitaano",
        body: `Nga tonnamala ssaawa nnamba ku assessment, zuula oba lead ono wa ddala. Ebibuuzo bitaano bimala.

## 1. Oyagala kukozesa ki ku masannyalaze?
Wuliriza ebyuma n'ekizibu ekibiri emabega. "Ebintu byange eby'omu firiigi byonooneka" nsonga ya maanyi okusinga "Njagala kumanya bumanya".

## 2. Amasannyalaze go aga grid gali gatya?
Geesigika, gatera okuvaako, oba toyungiddwako. Kino kikulaga grid-tied, hybrid, backup oba off-grid.

## 3. Okozesa ki oba osaasaanya ki kati?
Yuniti buli mwezi, ssente za Yaka, oba amafuta ga generator. Bw'aba tamanyi, okukebera amasannyalaze kukibalirira okuva ku byuma bye oba ku mesegi ze eza token.

## 4. Ekifo kiri ludda wa, era ani asalawo?
Weetaaga okumanya ekifo we kiri olw'okukikyalira. Era weetaaga okumanya oba oyogera n'omuntu asalawo era asasula, oba waliwo munne mu bufumbo, nnannyini nnyumba, olukiiko (board) oba ofiisi enkulu abalina okukkiriza.

## 5. Ddi, era wandisasudde otya?
Kati, mu myezi mitono, oba akyetegereza butegereza. Mu kaasi, oba mu bitundutundu (instalments). Tomuteeberereza ssente z'alina, era tosuubiza kuwolebwa okutannakkirizibwa.

## Olwo osalewo
- Mwetegefu: teekawo olunaku lwa assessment.
- Tannaba: mukkiriziganye olunaku lw'onooddamu okumutuukirira.
- Tekimusaanira: kimugambe n'ekisa. Ajja kujjukira nti wali mwesimbu.`
      },
      {
        key: "m2-l4",
        title: "Okuwandiika lead n'okussa ekitiibwa mu kasitoma",
        body: `Lead atawandiikiddwa abula. Lead awandiikiddwa mu bulagajjavu ayonoona obudde bw'omukugu.

## Muwandiike ku lunaku olwo lwennyini
Teekamu kasitoma, nnamba ye ey'essimu n'ekifo ng'emboozi okyagijjukira bulungi. Wandiika ebituufu bye wawulidde, so si by'osuubira: by'akozesa, by'asaasaanya, bye yasabye. Amannya ne nnamba z'essimu biwandiike bulungi; ennamba emu enkyamu efiiriza okutunda.

## Sooka osabe nga tonnakuŋŋaanya
- Mubuulire lwaki oyagala nnamba ye ey'essimu, era nti kkampuni ejja kumutuukirira ku ky'abuuzizza.
- Tereka ekifo kya GPS nga kasitoma akkirizza kyokka. App ekusaba okukikakasa.
- Kuba ebifaananyi by'ebyuma oba ebya nameplate zaabyo ng'oweereddwa olukusa lwokka.

## Kuuma by'okuŋŋaanyizza
Amannya ga bakasitoma, nnamba z'essimu, ebifo gye bali ne bye balina bya kyama byabwe (personal data). Etteeka lya Uganda erya Data Protection and Privacy Act, 2019 liragira nti ebintu ng'ebyo bikuŋŋaanyizibwa olw'ekigendererwa ekitegeerekeka era bikuumibwa bulungi. Mu nkola:
- Ebikwata ku bakasitoma bikuumire mu app, so si mu butabo bwo obw'obwannannyini oba mu bibinja by'emboozi eby'olukale.
- Togabana bikwata ku kasitoma omu ne kasitoma omulala, oba n'omuntu yenna atali wa kkampuni.
- Tokozesa nnamba za bakasitoma ku kintu kirala kyonna okuggyako emirimu kkampuni gy'erina nabo.

## Tuukiriza kye wasuubiza
Bwe wagamba nti "tujja kukukubira essimu Olwokutaano nga terunnayita", kakasa nti waliwo akikola. Obwesige kye kintu ky'otunda ddala.`
      }
    ],
    questions: [
      {
        key: "m2-q1",
        prompt: "Ku bano, ani asinga okusuubirwa okugula?",
        options: [
          "Amaka agalina amasannyalaze ageesigika era agakozesa matono nnyo",
          "Edduuka ly'eddagala erifiirwa ebintu eby'omu firiigi buli grid lw'evaako",
          "Omupangisa nnannyini nnyumba gwe yagaana okuteekako ekintu kyonna",
          "Omuntu ayagala okumanya obumanya era atayagala kuwa nnamba ya ssimu"
        ],
        explanation: "Edduuka ly'eddagala lirina ekizibu ekirifiiriza ssente era ekiddiŋŋana, solar eriko backup ky'egonjoola."
      },
      {
        key: "m2-q2",
        prompt: "Nsibuko ki etera okusinga okukuleetera leads empya?",
        options: [
          "Okukubira essimu abantu b'otomanyi",
          "Bakasitoma abamatidde abakusindikira abalala",
          "Okugula enkalala za nnamba z'essimu",
          "Okulindira ku ofiisi"
        ],
        explanation: "Kasitoma omusanyufu bw'akwogerako obulungi aleeta abantu abalina ekizibu kye kimu era abakwesiga dda."
      },
      {
        key: "m2-q3",
        prompt: "Lwaki obuuza nti \"ani asalawo?\" ng'osunsula lead?",
        options: [
          "Okwewala okukyalira ekifo",
          "Kubanga omuntu gw'oyogera naye ayinza obutaba ye akkiriza era asasula",
          "Okwongeza ebbeeyi",
          "Kubanga app ekyetaaga nga tennabalirira sisitemu"
        ],
        explanation: "Bwe wabaawo munne mu bufumbo, nnannyini nnyumba oba olukiiko abalina okukkiriza, weetaaga babeere mu mboozi nga quotation tennakolebwa."
      },
      {
        key: "m2-q4",
        prompt: "Kasitoma tamanyi yuniti mmeka z'akozesa. Kiki ekisinga okukolebwa ekiddako?",
        options: [
          "Teebereza omuwendo quotation erabike nga ya ssente ntono",
          "Mugambe nti solar si yiye",
          "Kibalirire n'okukebera amasannyalaze okuva ku byuma bye oba ku mesegi ze eza token",
          "Ekibuuzo kibuuke"
        ],
        explanation: "Okukebera amasannyalaze kuteebereza by'akozesa buli lunaku okuva ku lukalala lw'ebyuma oba ku mesegi za token."
      },
      {
        key: "m2-q5",
        prompt: "Ddi lw'okkirizibwa okutereka ekifo kya GPS ekya kasitoma?",
        options: [
          "Bulijjo, kiyamba omukugu",
          "Nga kasitoma akkirizza kyokka",
          "Ku bakasitoma ba bizinensi bokka",
          "Tekikkirizibwa n'akatono"
        ],
        explanation: "GPS bya kyama bya muntu (personal data) era eterekebwa ng'akkirizza kyokka; app ekusaba okukikakasa."
      },
      {
        key: "m2-q6",
        prompt: "Mukwano gwo atunda generator akusaba nnamba z'essimu za leads zo ezaakafunibwa. Okola ki?",
        options: [
          "Ozimuwa, kubanga mukwano gwo",
          "Omuwa eza bakasitoma ba bizinensi zokka",
          "Ogaana: ebikwata ku kasitoma bikozesebwa ku mirimu kkampuni gy'erina ne kasitoma oyo gyokka",
          "Ozimuguza"
        ],
        explanation: "Nnamba za bakasitoma bya kyama byabwe ebyakuŋŋaanyizibwa olw'ekigendererwa kimu, era tebirina kuweebwa balala."
      }
    ]
  },
  {
    key: "m3",
    title: "Okwekenneenya ebyetaago ne Solar Switch",
    summary:
      "Engeri y'okunyumya ne kasitoma ku kifo kye, okukola assessment, okukebera sisitemu eriwo n'okutuuka ku quotation ey'okulagirako mu app.",
    lessons: [
      {
        key: "m3-l1",
        title: "Emboozi ku kifo kya kasitoma",
        body: `Assessment ennungi mboozi ya bwegendereza. Sisitemu esobola kuba ntuufu kwenkana n'olukalala lw'okomyawo.

## Tambula mu kifo kyonna
Genda ekisenge ku kisenge ne kasitoma owandiike ebikozesa amasannyalaze. Abantu beerabira ppampu y'amazzi, amataala g'obukuumi, firiigi eyookubiri ne chaja z'essimu okutuusa lwe babiraba.

## Ku buli kyuma, wandiika ebintu bina
- Biri bimeka.
- Amaanyi gaakyo mu watts. Soma nameplate (akapande akali ku kyuma) w'osobola. Omuwendo oguva ku label gusinga ogwa bulijjo, era app ewandiika gw'okozesezza.
- Essaawa mmeka ze kikola buli lunaku, ne mu kiseera ki eky'olunaku. Eby'emisana bisobola okuva butereevu ku panel; eby'ekiro birina kuva mu bbaatule.
- Oba kikulu nnyo (critical), kwe kugamba kirina okusigala nga kikola amasannyalaze bwe gavaako.

## Faayo ku motor
Firiigi, freezer, ppampu, compressor n'ebyuma ebisa bisika surge nga bitandika. Wandiika surge label w'egiragira, oba buulira omukugu motor ya kika ki.

## Tunulatunula
- Panel ziyinza kuteekebwa wa? Akasolya katunudde ludda wa, era kiki ekikasiikiriza?
- Inverter ne bbaatule byanditeekeddwa wa: awakalu, awayita empewo, awali obukuumi?
- Waliwo sisitemu eriwo dda, generator, oba changeover switch?

Wandiika by'olaba. Essaawa ne watts kasitoma by'akuwa biba bya kuteebereza; kyogere mu by'owandiika omukugu amanye ebikyetaaga okukeberebwa.`
      },
      {
        key: "m3-l2",
        title: "Okukola assessment n'okubalirira sisitemu (sizing)",
        body: `Mu Solar Switch ensengeka bulijjo y'emu: kasitoma, ekifo, assessment, sizing.

## Assessment
Ggulawo kasitoma, londa ekifo otandike assessment. Teekamu buli kyuma n'omuwendo gwakyo, amaanyi, essaawa n'ebiseera mwe kikolera, era olage ebikulu ennyo. Londa ekika kya sisitemu. Sisitemu ya hybrid oba eya backup yeetaaga essaawa za backup ezaagalibwa; eya off-grid yeetaaga ennaku z'esobola okumala nga tewali musana (days of autonomy). Maliriza assessment ng'olukalala lutuufu.

Kino osobola okukikola nga tewali network. Omulimu oguterekeddwa nga toli ku intaneeti gusigala nga draft ku ssimu yo okutuusa lwe gumala okuweerezebwa (synchronise).

## Sizing
Sizing etwala assessment emaliriziddwa ne katalogu ya kkampuni n'ereeta enteekateeka (configurations): inverter, panel ne bbaatule ebikwatagana. Buli nteekateeka eraga ebikebereddwa byayo:
- Kiyise (Pass): ebipimo by'ekintu bituukiriza ekyetaagisa.
- Kigaanye (Fail): tekikwatagana. Enteekateeka eyo teweebwa.
- Kyetaaga okwekenneenyezebwa (Needs review): waliwo ekitasobodde kukakasibwa, emirundi mingi kubanga ekipimo kibulako oba kyetaaga okusalawo kw'omuntu. Omukugu yekka y'asobola okubigonjoola.

"Tekisobola kukakasibwa" (cannot validate) tekitegeeza nti "oboolyawo kirungi". Kitegeeza nti omukugu alina okukitunulamu.

## Bwe wataba kikwatagana
Sizing ekubuulira lwaki: tewali kintu kimala bunene, voltage etakwatagana, oba ebipimo ebibulako. Tokyetooloola ng'olonda ebintu ggwe kennyini. Ensonga gituuse ku mukugu oba ku mukulu alabirira sitoowa (inventory administrator).`
      },
      {
        key: "m3-l3",
        title: "Bakasitoma abalina dda solar",
        body: `Bakasitoma bangi balina dda sisitemu era baagala ebisingawo: backup ewangaala, panel endala, inverter esingako obunene. Okukebera okw'okwongera ku sisitemu (upgrade check) mu Solar Switch kubalirira ebikwatagana n'ebyuma bye balina.

## Soma label
Wandiika ebiri ku nameplate, so si kasitoma by'ajjukira:
- Voltage ya sisitemu, ye voltage ya bbaatule zonna awamu (battery bank): etera okuba 12, 24 oba 48 V.
- Inverter: amaanyi gaayo mu watts, n'oba panel ziyungibwa butereevu ku yo.
- Charge controller, bw'eba nga yeetongodde: MPPT oba PWM, amps zaayo ne voltage ya solar esinga gy'ekkiriza.
- Panel: ziri mmeka, watts zaazo, ne mmeka eziyungiddwa mu buli string.
- Bbaatule: ziri mmeka, voltage yaazo ne Ah, ekika kyazo (chemistry) n'emyaka gyazo.

Bw'otosobola kuzuula muwendo, gureke nga gwereere. Okukebera kujja kulamba ekitundu ekyo nti "kyetaaga okwekenneenyezebwa" mu kifo ky'okuteebereza.

## Amateeka okukebera ge kugoberera
- Kyonna ekyongerwako kirina okukwatagana ne voltage ya sisitemu. Sisitemu ya 24 V tesobola kumala gateekebwako bbaatule ya 48 V.
- Bbaatule ez'ebika (chemistry) eby'enjawulo tezigattibwa mu bank emu. Lithium eweebwa ng'edda mu kifo kya bank ya lead-acid, so si ng'eyongerwa ku yo.
- Bbaatule za lead-acid empya eziyungiddwa ku bank enkadde zissibwa wansi ne zikola ng'enkadde. Ku bank ekaddiye, okugikyusa yonna kye kitera okusinga.
- Panel endala zirina okugya mu voltage controller oba inverter gy'ekkiriza ne mu kkomo lyayo ery'amaanyi. Bw'eba ejjudde, okukebera kuwa controller oba inverter esingako obunene awamu ne panel.

## Bulijjo
Ebyuma ebiriwo kkampuni tennabikebera. Omukugu alina okukakasa ebipimo nga quotation yonna eva mu upgrade check tennakkirizibwa.`
      },
      {
        key: "m3-l4",
        title: "Okuva ku sizing okutuuka ku quotation ey'okulagirako",
        body: `Quotation mu Solar Switch eyita mu mitendera egitakyuka. Okugimanya kikusobozesa okubuulira kasitoma ddala ekiddako.

## 1. Draft
Okola quotation okuva ku nteekateeka ya sizing oba ku upgrade study. App eteeka ebbeeyi ku buli kintu okuva mu katalogu. Oyinza okwongerako obuweereza ng'okuteekawo sisitemu (installation).

## 2. Ey'okulagirako (illustrative)
Osobola okulaga oba okuweereza kasitoma quotation ey'okulagirako amangu ddala. Buli muko gubaako ebigambo "UNVERIFIED - FOR ILLUSTRATION ONLY" (tekinnakakasibwa, kya kulagirako kwokka). Ebalagirira okubayamba okusalawo, si kye tubawa mu butongole.

## 3. Okwekenneenya okw'ekikugu (technical review)
Ogiweereza. Omukugu akebera ebyuma ebikozesa amasannyalaze (load), bbaatule, panel, inverter n'ebyawandiikibwa ku kifo ng'agoberera olukalala lw'ebikeberebwa, n'agikkiriza, n'agizzaayo erongoosebwe oba n'agigaana. Tosobola kukkiriza nteekateeka yo ggwe kennyini.

## 4. Okukkirizibwa ku by'ebbeeyi (commercial approval)
Kwetaagisa ng'ebbeeyi eri wansi w'ebbeeyi esembayo wansi (floor) oba nga quotation erina obukwakkulizo obutali bwa bulijjo kwokka. Maneja y'asalawo.

## 5. Okufulumizibwa mu butongole
Revision ekkiriziddwa yokka y'esobola okufulumizibwa. App egiwa nnamba entongole n'olunaku kw'ekoma okukola, era n'ekwata ebintu mu sitoowa ku lwayo.

## Bwe wabaawo ekikyuka
Okukyusa ebintu, emiwendo, ebbeeyi oba obukwakkulizo kikola revision empya, era okukkirizibwa okwasooka kuba tekukyakola. Ekyo kikukuuma ggwe ne kasitoma: ekyakkirizibwa kye kyennyini ekifulumizibwa.

Buulira kasitoma amazima ku we batuuse: "Kuno kwe kuteebereza kwaffe. Omukugu waffe akwekenneenya, olwo n'ofuna quotation entongole."`
      }
    ],
    questions: [
      {
        key: "m3-q1",
        prompt: "Wa awasinga okuggya amaanyi g'ekyuma mu watts?",
        options: [
          "Kasitoma by'ajjukira",
          "Ku nameplate eri ku kyuma",
          "Ku kyuma kya muliraanwa ekikifaanana",
          "Omuwendo gwonna ogukuuma sisitemu nga ntono"
        ],
        explanation: "Omuwendo gw'oku nameplate gusinga ogwa bulijjo oba ogujjukirwa, era app ewandiika gye guvudde."
      },
      {
        key: "m3-q2",
        prompt: "Lwaki ekiseera ky'olunaku ekyuma mwe kikolera kikulu?",
        options: [
          "Si kikulu",
          "Eby'emisana bisobola okuva butereevu ku panel, ate eby'ekiro birina kuva mu bbaatule",
          "Ebyuma bikozesa amasannyalaze matono ekiro",
          "Ebbeeyi ya yuniti bulijjo eba wansi ekiro"
        ],
        explanation: "Ebikola ekiro bye bisalawo obunene bwa bbaatule; eby'emisana bisobola okuweebwa solar butereevu."
      },
      {
        key: "m3-q3",
        prompt: "Ekikebereddwa mu sizing kiraga \"kyetaaga okwekenneenyezebwa\" (needs review). Ekyo kitegeeza ki?",
        options: [
          "Oboolyawo kirungi, weeyongere",
          "Enteekateeka egaanye",
          "Omukugu alina okukikakasa; tekiyinza kutwalibwa ng'ekiyise",
          "Kasitoma alina okusooka okusasula deposit"
        ],
        explanation: "Waliwo ekitasobodde kukakasibwa. Omukugu yekka y'asobola okukigonjoola."
      },
      {
        key: "m3-q4",
        prompt: "Kasitoma alina bank ya lead-acid eya 48 V ayagala backup ewangaala era ayagala lithium. Upgrade check emuwa ki?",
        options: [
          "Okwongerako bbaatule emu eya lithium ku mabbali g'eza lead-acid",
          "Okukyusa bank yonna n'eba ya lithium, kubanga ebika eby'enjawulo tebigattibwa mu bank emu",
          "Okukyusa sisitemu n'eba ya 12 V",
          "Tewali; lithium tesobola kukozesebwa ku sisitemu eriwo dda"
        ],
        explanation: "Ebika (chemistry) tebitabulwa mu bank emu. Lithium eweebwa ng'edda mu kifo kya bank yonna."
      },
      {
        key: "m3-q5",
        prompt: "Tosobola kuzuula voltage ya solar esinga ku charge controller enkadde. Owandiika ki mu upgrade check?",
        options: [
          "Omuwendo ogwa bulijjo okuva ku controller endala",
          "Omuwendo ogusinga obunene ogukkirizibwa",
          "Kireke nga kyereere, ekitundu ekyo kirambibwe omukugu akikakase",
          "Voltage ya bbaatule"
        ],
        explanation: "Ekipimo ekibulako kitegeeza \"tekisobola kukakasibwa\". Toyiiyanga kipimo."
      },
      {
        key: "m3-q6",
        prompt: "Kiki ekirina okulabika ku buli muko gwa quotation etannakkirizibwa n'okufulumizibwa?",
        options: [
          "Commission ya agent",
          "\"UNVERIFIED - FOR ILLUSTRATION ONLY\"",
          "Ebbeeyi esembayo wansi (floor price)",
          "Nnamba y'essimu ey'omukugu"
        ],
        explanation: "Quotation ez'okulagirako bulijjo ziteekebwako akabonero ako, ziremenga kutwalibwa nga quotation entongole."
      }
    ]
  },
  {
    key: "m4",
    title: "Okwanjula, okumaliriza okutunda n'okutunda mu bwesimbu",
    summary:
      "Engeri y'okwanjula proposal, okuddamu ebiwakanyizibwa ebya bulijjo, okumaliriza okutunda obulungi n'okukuuma amateeka agakuuma kasitoma ne kkampuni.",
    lessons: [
      {
        key: "m4-l1",
        title: "Okwanjula proposal",
        body: `Kasitoma tayagala panel. Ayagala mataala agasigala nga gaaka, ebintu by'atunda ebitayonooneka, oba bbiiru entono. Mwanjulire eky'okuddamu eri ekizibu kye.

## Tandikira ku bye yakubuulira
"Wagambye nti osaasaanya nga bwe ziti buli mwezi, era amasannyalaze gavaako akawungeezi akasinga." Laga nti wawuliriza nga tonnalaga bbeeyi.

## Laga leero ng'ogeraageranya n'enkya
Kozesa emiwendo okuva mu assessment: bye bakozesa buli lunaku, kye bibamalako kati, sisitemu ky'eneewa, n'ebbanga backup ly'emala ku byuma byabwe ebikulu ennyo. Kozesa emiwendo egiri ku quotation. Toyongerako emirungi okusingawo okuva mu mutwe gwo.

## Nnyonnyola ebirimu
Yita mu buli lunyiriri: panel, inverter, bbaatule, mounting, ebikuuma sisitemu, waya, okugiteekawo. Nnyonnyola warranty eri ku buli kintu nga bw'ewandiikiddwa. Bwe wabaawo ekitalimu, kyogere kati, so si nga bamaze okusasula.

## Bawe eky'okulondako we kisoboka
Bakasitoma kibanguyira okusalawo wakati w'eby'okulondako okusinga wakati wa yee ne nedda: okugeza sisitemu y'ebyuma ebikulu ennyo kati, ng'erina ebbanga ery'okwongerako panel oba bbaatule oluvannyuma.

## Yogera w'etuuse
Quotation bw'eba ya kulagirako, gamba nti ekyalina okukakasibwa omukugu era nti quotation entongole y'eddako. Bakasitoma bassa ekitiibwa mu nkola etegeerekeka.

Olwo sirika obaleke babuuze ebibuuzo.`
      },
      {
        key: "m4-l2",
        title: "Okuddamu ebiwakanyizibwa ebya bulijjo",
        body: `Ekiwakanyizibwa kibuuzo kasitoma ky'atannamaliriza kubuuza. Kiddemu mu bwesimbu.

## "Ya bbeeyi nnyo"
Gigeraageranye ne bye basasula dda: amasannyalaze ga buli mwezi, amafuta ga generator, ebintu ebyonooneka. Balage okubalirira kw'okusasula mu bitundutundu bwe kiba nga okuwolebwa bakusobola okukufuna. Bawe omutendera ogusooka omutono ogusobola okukula. Tosala bbeeyi kusukka ku ky'okkirizibwa, era toggyamu bitundu bya bukuumi olw'okugikendeeza.

## "Nsobola okugula ebitundu ebya layisi mu kibuga"
Kiyinzika. Babuuze ebirimu: yabalirirwa ku byuma byabwe, ebitundu bikwatagana, ani agiteekawo, era ani ayanukula ng'efudde? Sisitemu ekwataganyiziddwa, ekakasiddwa era eriko warranty kintu kya njawulo ku bitundu ebiguliddwa kimu kimu.

## "Solar tekola ng'enkuba etonnya"
Ekola matono ku nnaku ez'ekizikiza, era y'ensonga lwaki sisitemu ebalirirwa ku ssaawa z'omusana ez'obwegendereza. Ku sisitemu ya hybrid, grid y'ejjuza ekibulako. Beera mwesimbu: embeera y'obudde embi bw'eddiriŋŋana ekendeeza sisitemu yonna ky'ekola.

## "Bbaatule zifa mangu"
Bbaatule zikaddiwa olw'okukozesebwa. Ebbanga lye ziwangaala lisinziira ku kika kyazo (chemistry), we zikoma okuggwaamu, ne cycles abaazikola ze baawandiika. Balage emiwendo egiri ku kintu, era onnyonnyole engeri sisitemu gy'ebalirirwamu okusigala mu gyo.

## "Ka nsooke nkirowoozeeko"
Ekyo kituufu. Mubuuze ky'ayagala okulowoozaako, kiddemu bw'oba osobola, era mukkiriziganye olunaku lwe munaddamu okwogera. Olwo omutuukirire ku lunaku olwo.

Toddangamu kiwakanyizibwa na kisuubizo quotation ky'etekola.`
      },
      {
        key: "m4-l3",
        title: "Okumaliriza okutunda n'ebiddirira yee",
        body: `Okumaliriza okutunda (closing) kwe kusaba kasitoma asalewo ng'amaze okufuna bye yeetaaga okusalawo.

## Buuza kaati
"Tugende mu maaso n'eky'okulondako kino?" Eky'okuddamu bwe kiba nti tannaba, zuula ekibulako: omuwendo, omuntu alina okukkiriza, oba ssente.

## Kiwandiike bulungi
- Quotation efulumiziddwa mu butongole yokka y'esobola okukkirizibwa. Kasitoma bw'akkiriza ey'okulagirako, ekiddako kwe kugitwala yeekenneenyezebwe era efulumizibwe.
- Wandiika okukkiriza mu app. Ekyo kiggulawo omulimu gw'okuteekawo sisitemu era ne kikwatira kasitoma ebintu.
- Engeri y'okusasula, deposit n'okusasula mu bitundutundu biba ebyo kkampuni bye yakkiriza. Tokkiriziganya nteekateeka za kyama.
- Kasitoma bw'agaana, nakyo kiwandiike, n'ensonga. Kiyigiriza ttiimu yonna.

## Nga sisitemu tennateekebwawo
Kakasa olunaku, ani anaabeera ku kifo, ebyuma we binaateekebwa n'ekintu kyonna kasitoma ky'alina okuteekateeka. Buulira omukugu byonna bye wayiga mu kukyala kwo.

## Mu kukwasa kasitoma sisitemu (handover)
Kakasa nti kasitoma alagibwa engeri y'okusoma inverter, sisitemu by'esobola ne by'etesobola kukozesa, eky'okukola nga waliwo ekyonoonese n'oyo gw'alina okukubira. Ddamu onnyonnyole warranty.

## Oluvannyuma
Mukubire essimu oluvannyuma lwa wiiki n'oluvannyuma lw'omwezi. Kasitoma awulira nti afiibwako akuwa leads zo essatu eziddako. Musabe akusindikire abalala, era omusabe olukusa okukozesa erinnya lye.`
      },
      {
        key: "m4-l4",
        title: "Amateeka g'otomenya n'akatono",
        body: `Amateeka gano gakuuma kasitoma, kkampuni naawe. Tegateesebwako, ne bwe kuba ng'okutunda kunaatera okuggwa.

- Toyanjulanga quotation ey'okulagirako ng'entongole, era toggyangako oba tokwekanga kabonero ka "UNVERIFIED".
- Tosuubizanga kukekkereza, ssaawa za backup oba nkola ebitali ku quotation.
- Toyiiyanga kipimo oba okugamba kasitoma nti ebitundu bikwatagana nga app egamba nti tesobola kubikakasa.
- Tokkirizanga nteekateeka yo ggwe kennyini. Okukkiriza okw'ekikugu kwa mukugu atali nnannyini quotation.
- Towanga discount esukka ku buyinza bwo. Ebbeeyi eziri wansi wa floor zeetaaga okukkirizibwa maneja.
- Tosuubizanga bintu mu sitoowa oba lunaku lwa kubireeta sisitemu by'etannakakasa. Ebintu bikwatibwa nga quotation efulumiziddwa mu butongole lwokka.
- Tokakanga muntu era tomulimbanga. Tewali nsalesale za bulimba, tewali kutiisa bantu, tewali kukweka ssente ezisasulwa.
- Tokkirizanga kusasulwa bweru wa nkola kkampuni gye yakkiriza.
- Togabananga oba okukozesa obubi ebikwata ku bakasitoma.
- Bw'olaba ekintu eky'obulabe ku kifo, gamba nga waya ezoonoonese, bbaatule ezibuguma ennyo oba waya eziyungiddwa nga tezibikkiddwa, buulira kasitoma era okitegeeze omukugu.
- Bw'oba tomanyi kya kuddamu ku kibuuzo eky'ekikugu, kyogere oleete omukugu.

## Lwaki kikulu
Kasitoma omu eyabuulirwa amazima n'afuna kye yasuubizibwa aleeta bizinensi nnyingi okusinga ekkumi abaasuubizibwa ebisukkiridde. Agent wa Solar Switch alina satifikeeti ye muntu kasitoma gw'asobola okukkiriza.`
      }
    ],
    questions: [
      {
        key: "m4-q1",
        prompt: "Ngeri ki esinga ey'okutandika okwanjula proposal?",
        options: [
          "N'ebbeeyi yonna awamu",
          "N'ebipimo eby'ekikugu ebya inverter",
          "Ng'oddamu ekizibu kasitoma kye yakubuulira",
          "Ng'ovumirira kkampuni endala"
        ],
        explanation: "Tandikira ku kizibu kyabwe, proposal erabike bulungi nti kye ky'okuddamu kyakyo."
      },
      {
        key: "m4-q2",
        prompt: "Kasitoma agamba nti sisitemu ya bbeeyi nnyo. Kuddamu ki okukkirizibwa?",
        options: [
          "Ggyamu breaker ne surge protection okukendeeza ebbeeyi",
          "Muwe discount yonna eyeetaagisa okumaliriza okutunda leero",
          "Geraageranya ne bye basaasaanya kati, obawe omutendera ogusooka omutono ogusobola okukula",
          "Musuubize nti sisitemu ejja kwesasula mu myezi mukaaga"
        ],
        explanation: "Gigeraageranye n'ebisaasaanyizibwa kati era owe eky'okulondako eky'emitendera. Toggyangamu bitundu bya bukuumi era tosukkanga buyinza bwo obwa discount."
      },
      {
        key: "m4-q3",
        prompt: "Kasitoma akkirizza quotation ey'okulagirako era ayagala kusasula kati. Okola ki?",
        options: [
          "Otwala ssente n'oteekawo sisitemu",
          "Ogiweereza yeekenneenyezebwe mu by'ekikugu, esooke ekkirizibwe era efulumizibwe mu butongole",
          "Okyusa PDF okuggyako watermark",
          "Ogikkiriza ggwe kennyini okukekkereza obudde"
        ],
        explanation: "Quotation efulumiziddwa mu butongole yokka y'esobola okukkirizibwa. Erina okusooka okwekenneenyezebwa n'okufulumizibwa."
      },
      {
        key: "m4-q4",
        prompt: "Ani ayinza okuwa okukkiriza okw'ekikugu ku quotation yo?",
        options: [
          "Ggwe, bw'oba weekakasa",
          "Kasitoma",
          "Omukugu atali nnannyini quotation",
          "Agent yenna atunda"
        ],
        explanation: "Agent tasobola n'akatono kukkiriza nteekateeka ye."
      },
      {
        key: "m4-q5",
        prompt: "Kasitoma ayagala ebbeeyi eri wansi w'ebbeeyi esembayo wansi (floor price). Kiki ekibaawo?",
        options: [
          "Oyinza okukkiriza okutunda bwe kuba kunene",
          "Kyetaaga okukkirizibwa maneja ku by'ebbeeyi (commercial approval)",
          "Omukugu y'asalawo",
          "App ekikola yokka"
        ],
        explanation: "Ebbeeyi eziri wansi wa floor, n'obukwakkulizo obutali bwa bulijjo, byetaaga okukkirizibwa maneja."
      },
      {
        key: "m4-q6",
        prompt: "Ng'okyadde, olaba waya ezaayidde ku sisitemu ya kasitoma eriwo. Olina kukola ki?",
        options: [
          "Kireke; si ggwe wagiteekawo",
          "Kikanike ggwe kennyini",
          "Buulira kasitoma era okitegeeze omukugu",
          "Kikozese okutiisa kasitoma agule"
        ],
        explanation: "Ebizibu by'obukuumi byogerwa mu bwesimbu ne bituusibwa ku mukugu."
      }
    ]
  }
];
