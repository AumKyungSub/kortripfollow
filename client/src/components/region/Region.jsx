import React, {useEffect, useState} from 'react'

// Components
import Header from '../Header/Header'
import Category from './component/Category/Category'
import RegionList from './component/regionList/RegionList'
import Footer from '../footer/Footer'


// Page css
import './Region.style.css'

const Region = () => {

    const [locationList, setLocationList] = useState([]);
    const [selectedRegion, setSelectedRegion] = useState('전체'); // 선택된 지역

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

  // 선택된 지역에 따라 필터링
    const filteredList = (selectedRegion === '전체'
        ? locationList
        : locationList.filter(item => item.region === selectedRegion)
    ).sort(() => Math.random() - 0.5);

  return (
    <div>
        <Header/>
        <div className="emptyLine1px"></div>
        <Category selected={selectedRegion} setSelected={setSelectedRegion} />
        <div className="regionListWholeCover">
          {filteredList.map((reg)=>(
            <RegionList key={reg.id} item={reg}/>
          ))}
        </div>
        <Footer/>
    </div>
  )
}

export default Region
