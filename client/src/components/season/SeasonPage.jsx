import React, { useState, useEffect } from 'react'

// Components
import Header from '../Header/Header'
import SeasonCategory from './component/seasonCategory/SeasonCategory'
import SeasonBanner from './component/seasonBanner/SeasonBanner'
import SeasonList from './component/seasonList/SeasonList'
import Footer from '../footer/Footer'

// Page css
import './SeasonPage.style.css'

const SeasonPage = () => {

  const [seasonBanners, setSeasonBanner] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState('봄'); 
  const [locationList, setLocationList] = useState([]);

  // seasons 테이블
  const getSeasons =async() => {
        let url = `http://localhost:3000/seasons`;
        let response = await fetch(url);
        let data = await response.json();
        setSeasonBanner(data);
  };
  
  useEffect(()=>{
      getSeasons();
  },[])
  
  const filteredListBanner = seasonBanners
    .filter(item => item.season === selectedSeason)
    .sort(() => Math.random() - 0.5)
    .slice(0, 1);

    // rankings 테이블
    const getLocation = async () => {
        // let url = `http://localhost:3000/rankings`;
        let url = `http://https://port-0-kortripfollow-mhg6zzrn5356f2c9.sel3.cloudtype.app/rankings`;
        let response = await fetch(url);
        let data = await response.json();
        console.log(data);
        setLocationList(data);
    };

    useEffect(()=>{
        getLocation();
    },[])

  const filteredListList = locationList
    .filter(item => 
      item.season.includes(selectedSeason) || item.season.includes('사계절')
    )
    .sort(() => Math.random() - 0.5);    
  
  return (
    <div>
      <Header/>
        <SeasonCategory selected={selectedSeason} setSelected={setSelectedSeason} />
        {filteredListBanner.map((sea)=>(
          <SeasonBanner key={sea.id} item={sea}/>
        ))}
        <SeasonList
          bannerList={filteredListBanner}
          list={filteredListList}
          location={locationList}
          />
      <Footer/>
    </div>
  )
}

export default SeasonPage
